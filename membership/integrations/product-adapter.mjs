import { createHash, timingSafeEqual } from 'node:crypto';

export const PRODUCT_ADAPTER_SCHEMA = `
CREATE TABLE IF NOT EXISTS union_product_contracts (
  central_user_id text PRIMARY KEY, membership_id text NOT NULL, revision integer NOT NULL,
  starts_at bigint NOT NULL, expires_at bigint NOT NULL, active boolean NOT NULL,
  frozen jsonb NOT NULL, contract jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS union_product_operations (
  id text PRIMARY KEY, central_user_id text NOT NULL, payload_hash text NOT NULL, applied_at bigint NOT NULL
);`;
const stable = value => JSON.stringify(value, (_key,v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b))) : v);
const digest = value => createHash('sha256').update(stable(value)).digest('hex');
function guard(condition, code) { if (!condition) {const error = new Error(code);error.status=409;error.code=code;throw error;} }

/** All hooks run in the product's own database transaction, including its real allowance writes.
 * Installing this kit alone does NOT open access: every hook and its catalog must be verified.
 */
export function createProductAdapter({ db, token, hooks, verified = false, now = Date.now }) {
  const enabled = () => verified && ['read','pause','install','grant','extend','revoke','restore'].every(key => typeof hooks?.[key] === 'function');
  async function transaction(work) { return db.transaction(work); }
  async function execute(action, body) {
    guard(typeof body.centralUserId === 'string' && body.centralUserId, 'central_user_required');
    if (!enabled()) return action === 'snapshot' ? {ready:false,reason:'product_adapter_not_verified'} : Promise.reject(Object.assign(new Error('product_adapter_not_verified'),{status:503}));
    return transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,17))',[body.centralUserId]);
      const record = (await tx.query('SELECT * FROM union_product_contracts WHERE central_user_id=$1 FOR UPDATE',[body.centralUserId])).rows[0];
      if (action === 'snapshot') {
        const current = await hooks.read(tx,body.centralUserId,now());
        const { frozen: _frozen, ...publicState } = current;
        return {...publicState,ready:true,unionActive:Boolean(record?.active),unionMembershipId:record?.membership_id};
      }
      guard(typeof body.operationId === 'string' && body.operationId.length <= 250,'operation_id_required');
      const hash = digest({action,...body});
      const applied = (await tx.query('SELECT payload_hash FROM union_product_operations WHERE id=$1',[body.operationId])).rows[0];
      if (applied) {guard(applied.payload_hash===hash,'operation_conflict');return {ok:true,replayed:true};}
      if (action === 'activate') {
        guard(!record?.active || record.membership_id === body.membershipId,'another_union_membership_active');
        if (!record?.active) {
          const current=await hooks.read(tx,body.centralUserId,now());
          guard(current.autoRenewActive===false && current.pendingReservations===0 && current.pendingSubscriptionOrder===false,'original_membership_busy');
          guard(current.tierRank <= body.contract.effectiveTierRank,'higher_tier_changed');
          await hooks.pause(tx,current,body,now());
          await hooks.install(tx,current,body,now());
          await tx.query(`INSERT INTO union_product_contracts(central_user_id,membership_id,revision,starts_at,expires_at,active,frozen,contract) VALUES($1,$2,$3,$4,$5,true,$6,$7)
            ON CONFLICT(central_user_id) DO UPDATE SET membership_id=EXCLUDED.membership_id,revision=EXCLUDED.revision,starts_at=EXCLUDED.starts_at,expires_at=EXCLUDED.expires_at,active=true,frozen=EXCLUDED.frozen,contract=EXCLUDED.contract`,[body.centralUserId,body.membershipId,body.revision,body.startsAt,body.expiresAt,current.frozen,body.contract]);
        }
      } else {
        if ((!record || !record.active) && ['revoke','restore'].includes(action)) {
          await tx.query('INSERT INTO union_product_operations(id,central_user_id,payload_hash,applied_at) VALUES($1,$2,$3,$4)',[body.operationId,body.centralUserId,hash,now()]);
          return {ok:true,alreadyInactive:true};
        }
        guard(record && record.membership_id===body.membershipId,'membership_not_activated');
        if (action === 'grant') {
          guard(record.active && now()<Number(record.expires_at) && body.expiresAt<=Number(record.expires_at) && body.expiresAt>now(),'grant_outside_validity');
          guard(Number.isSafeInteger(body.amount)&&body.amount>0&&typeof body.unit==='string','invalid_grant');
          guard(['monthly','yearly'].includes(body.planId),'plan_required');
          guard(record.contract.grants[body.planId]?.some(grant=>grant.unit===body.unit&&grant.amount>=body.amount),'grant_exceeds_contract');
          await hooks.grant(tx,record,body,now());
        } else if (action === 'extend') {
          if (body.revision >= record.revision && record.active) {
            await hooks.extend(tx,record,body,now());
            await tx.query('UPDATE union_product_contracts SET expires_at=$2,revision=$3 WHERE central_user_id=$1',[body.centralUserId,body.expiresAt,body.revision]);
          }
        } else if (action === 'revoke') {
          await hooks.revoke(tx,record,body,now());
        } else if (action === 'restore') {
          if (record.active && body.revision>=record.revision) {
            await hooks.restore(tx,record,body,now());
            await tx.query('UPDATE union_product_contracts SET active=false,revision=$2 WHERE central_user_id=$1',[body.centralUserId,body.revision]);
          }
        } else guard(false,'unknown_operation');
      }
      await tx.query('INSERT INTO union_product_operations(id,central_user_id,payload_hash,applied_at) VALUES($1,$2,$3,$4)',[body.operationId,body.centralUserId,hash,now()]);
      return {ok:true};
    });
  }
  return {
    execute,
    async handle(action, body, suppliedToken) {
      const left=Buffer.from(token||''),right=Buffer.from(suppliedToken||'');
      if (!left.length||left.length!==right.length||!timingSafeEqual(left,right)) throw Object.assign(new Error('client_required'),{status:401});
      return execute(action,body);
    },
  };
}

/** Use in both creation and fulfillment of native recurring/one-time subscription orders; top-ups remain allowed. */
export async function assertStandaloneSubscriptionAllowed(tx, centralUserId) {
  const active = (await tx.query('SELECT 1 FROM union_product_contracts WHERE central_user_id=$1 AND active=true',[centralUserId])).rows[0];
  guard(!active,'union_membership_active');
}
