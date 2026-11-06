import { randomUUID } from 'node:crypto';
export const OUTBOX_SCHEMA = `CREATE TABLE IF NOT EXISTS union_telemetry_outbox (
  id text PRIMARY KEY, central_user_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('event','receipt')),
  payload jsonb NOT NULL, created_at bigint NOT NULL, sent_at bigint, attempts integer NOT NULL DEFAULT 0
);`;
/** Call within the same product transaction that commits payment, refund, cost or a successful core task. */
export async function enqueueUnionTelemetry(tx, {id = randomUUID(), centralUserId, kind, payload, now = Date.now()}) {
  if (!centralUserId) throw new Error('central_user_required');
  await tx.query('INSERT INTO union_telemetry_outbox(id,central_user_id,kind,payload,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,centralUserId,kind,payload,now]);
}
export async function flushUnionTelemetry(db, client, {now = Date.now()} = {}) {
  const pending = (await db.query('SELECT * FROM union_telemetry_outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 100')).rows;
  for (const item of pending) {
    try {
      if (item.kind==='event') await client.event(item.central_user_id,item.payload.name,item.payload.context,item.id,Number(item.created_at));
      else await client.receipt(item.central_user_id,{...item.payload,id:item.id});
      await db.query('UPDATE union_telemetry_outbox SET sent_at=$2,attempts=attempts+1 WHERE id=$1 AND sent_at IS NULL',[item.id,now]);
    } catch { await db.query('UPDATE union_telemetry_outbox SET attempts=attempts+1 WHERE id=$1',[item.id]); }
  }
}
