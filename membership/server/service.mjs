import { randomUUID } from 'node:crypto';
import { addMonths, assignVariant, catalogProblems, effectiveContract, EVENT_NAMES, grantSchedule, insist, PRODUCT_IDS, safeReturnUrl, WEBSITE_ORIGIN } from '../shared/domain.mjs';

const row = result => result.rows[0];
const id = prefix => `${prefix}_${randomUUID().replaceAll('-', '').slice(0,28)}`;
export class MembershipService {
  constructor({ db, catalog, adapters, payments, config, now = Date.now }) { Object.assign(this, { db, catalog, adapters, payments, config, now }); }
  entryTesting() { return ['staging','integration'].includes(this.config.environment); }
  stagingGroup(userId) { return this.entryTesting() && Object.hasOwn(this.config.testGroups || {}, userId) ? this.config.testGroups[userId] : null; }
  assertTransactionsAllowed() { insist(!this.entryTesting(),403,'staging_transactions_disabled','测试环境仅用于入口与登录联调，真实交易与权益发放关闭'); }
  async enroll(userId, productId, { baselineStatus = 'unknown', isTest = false } = {}) {
    insist(PRODUCT_IDS.includes(productId), 400, 'invalid_product', '来源产品无效');
    const staging = this.entryTesting();
    const group = this.stagingGroup(userId);
    if (staging ? !group : !this.config.experimentEnabled) return staging ? null : await this.assignment(userId) || null;
    const variant = group || assignVariant(userId, this.config.version, this.config.salt);
    isTest = staging || isTest;
    await this.db.query(`INSERT INTO union_assignments(central_user_id,experiment_version,variant,first_product,baseline_status,is_test,enrolled_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [userId, this.config.version, variant, productId, baselineStatus, isTest, this.now()]);
    return row(await this.db.query('SELECT * FROM union_assignments WHERE central_user_id=$1 AND experiment_version=$2', [userId, this.config.version]));
  }
  async assignment(userId) { return row(await this.db.query('SELECT * FROM union_assignments WHERE central_user_id=$1 AND experiment_version=$2', [userId, this.config.version])); }
  async membership(userId) { return row(await this.db.query('SELECT * FROM union_memberships WHERE central_user_id=$1', [userId])); }
  problems() {
    return [...catalogProblems(this.catalog), ...(!this.adapters.configured() ? ['五款产品接口未全部配置'] : []), ...(!this.payments.ready() ? ['支付渠道未配置'] : [])];
  }
  async eligibility(userId) {
    const assignment = await this.assignment(userId);
    const membership = await this.membership(userId);
    const staging = this.entryTesting();
    const testGroup = this.stagingGroup(userId);
    const variant = assignment?.variant || testGroup;
    const treatment = staging ? Boolean(testGroup && variant === 'B' && (!assignment || assignment.is_test)) : Boolean(assignment?.variant === 'B' && this.config.experimentEnabled && !assignment.is_test);
    const owned = Boolean(membership && !['expired'].includes(membership.status));
    const visible = staging ? treatment : treatment || owned;
    return { visible, purchasable: !staging && treatment && this.config.salesEnabled && !this.problems().length, variant: variant || null, version: this.config.version, membership: membership ? { id: membership.id, status: membership.status, startsAt: Number(membership.starts_at), expiresAt: Number(membership.expires_at) } : null };
  }
  async offers(userId) {
    const eligibility = await this.eligibility(userId);
    return { ...eligibility, catalog: eligibility.visible ? this.catalog : null, ...(this.entryTesting() && eligibility.visible ? { displayPricing: this.config.displayPricing } : {}) };
  }
  async quote(userId, planId) {
    this.assertTransactionsAllowed();
    const eligibility = await this.eligibility(userId);
    insist(eligibility.purchasable, 403, 'sale_unavailable', '当前暂未开放联合会员购买');
    insist(!(await this.db.query("SELECT 1 FROM union_orders WHERE central_user_id=$1 AND status='refunding'", [userId])).rowCount, 409, 'refund_processing', '退款处理中，请完成后再购买');
    const plan = this.catalog.plans.find(plan => plan.id === planId);
    insist(plan, 400, 'invalid_plan', '请选择月卡或年卡');
    const current = await this.adapters.snapshots(userId);
    const active = await this.membership(userId);
    insist(!active || ['active', 'expired'].includes(active.status), 409, 'membership_processing', '上次权益操作仍在处理中');
    insist(!active || active.status === 'expired' || Number(active.expires_at) > this.now(), 409, 'restoration_pending', '原会员正在恢复，请稍后重新确认');
    const continuing = active?.status === 'active' && Number(active.expires_at) > this.now();
    // Renewals retain the original contract and frozen high-tier snapshot, even after catalog changes.
    const contracts = continuing ? active.contracts : this.catalog.products.map(product => effectiveContract(product, current[product.id]));
    for (const contract of contracts) insist(Array.isArray(contract.grants?.[planId]) && contract.grants[planId].length > 0 && contract.grants[planId].every(grant => ['monthly','upfront'].includes(grant.schedule) && Number.isSafeInteger(grant.amount) && grant.amount > 0 && typeof grant.unit === 'string'), 503, 'grant_unverified', `${contract.name} 的实际档位额度尚未完整核验`);
    for (const product of this.catalog.products) {
      insist(current[product.id]?.ready && current[product.id]?.autoRenewActive === false && current[product.id]?.pendingReservations === 0 && current[product.id]?.pendingSubscriptionOrder === false, 409, 'product_not_ready', `请先确认 ${product.name} 的权益和自动续费状态`);
    }
    const quoteId = id('uq');
    const snapshot = { version: this.catalog.version, plan: structuredClone(plan), contracts, continuing: continuing ? active.id : null, revision: active?.revision || 0 };
    await this.db.query('INSERT INTO union_quotes(id,central_user_id,plan_id,snapshot,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [quoteId, userId, planId, snapshot, this.now(), this.now() + 300_000]);
    return { id: quoteId, expiresAt: this.now() + 300_000, ...snapshot };
  }
  async createOrder(userId, quoteId, key, attribution = {}) {
    this.assertTransactionsAllowed();
    insist(typeof key === 'string' && /^[\w-]{12,100}$/.test(key), 400, 'idempotency_required', '请携带有效的订单幂等标识');
    insist((await this.eligibility(userId)).purchasable, 403, 'sale_unavailable', '当前暂未开放联合会员购买');
    return this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [userId]);
      insist(!(await tx.query("SELECT 1 FROM union_orders WHERE central_user_id=$1 AND status='refunding'", [userId])).rowCount, 409, 'refund_processing', '退款处理中，请完成后再购买');
      const existing = row(await tx.query('SELECT * FROM union_orders WHERE central_user_id=$1 AND idempotency_key=$2', [userId, key]));
      if (existing) { insist(existing.snapshot.quoteId === quoteId, 409, 'idempotency_conflict', '订单标识已经用于其他报价'); return existing; }
      const quote = row(await tx.query('SELECT * FROM union_quotes WHERE id=$1 AND central_user_id=$2', [quoteId, userId]));
      insist(quote && Number(quote.expires_at) > this.now(), 409, 'quote_expired', '报价已过期，请重新确认权益');
      insist(quote.snapshot.version === this.catalog.version, 409, 'catalog_changed', '套餐已更新，请重新确认');
      const current = row(await tx.query('SELECT * FROM union_memberships WHERE central_user_id=$1', [userId]));
      insist((current?.revision || 0) === quote.snapshot.revision && (!current || !['activating', 'restoring'].includes(current.status)), 409, 'membership_changed', '会员状态已变化，请重新确认');
      insist(!(await tx.query("SELECT 1 FROM union_orders WHERE central_user_id=$1 AND status='pending'", [userId])).rowCount, 409, 'pending_order', '已有待支付订单，请先完成或关闭');
      const entry = ['paywall', 'account', 'website', 'direct'].includes(attribution.entry) ? attribution.entry : 'direct';
      const source = entry === 'website' ? 'website' : PRODUCT_IDS.includes(attribution.productId) ? attribution.productId : 'keban';
      const returnUrl = source === 'website' ? new URL('/', this.config.websiteOrigin || WEBSITE_ORIGIN).href : safeReturnUrl(attribution.returnUrl, source, this.config.productOrigins, this.config.origin);
      const assignment = await this.assignment(userId);
      const order = { id: id('uo'), amount: quote.snapshot.plan.priceCents, expiresAt: this.now() + 900_000 };
      // No network I/O inside this transaction: checkout creation happens after the committed order.
      return row(await tx.query(`INSERT INTO union_orders(id,central_user_id,idempotency_key,plan_id,amount_cents,currency,status,snapshot,attribution,experiment_version,variant,is_test,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,'CNY','pending',$6,$7,$8,'B',$9,$10,$11) RETURNING *`, [order.id, userId, key, quote.plan_id, order.amount, { ...quote.snapshot, quoteId }, { productId: source, entry, returnUrl }, assignment.experiment_version, assignment.is_test, this.now(), order.expiresAt]));
    });
  }
  async checkout(userId, orderId) {
    this.assertTransactionsAllowed();
    const order = await this.order(userId, orderId);
    if (order.status !== 'pending' || order.code_url) return order;
    insist(Number(order.expires_at) > this.now(), 409, 'order_expired', '订单已过期');
    const codeUrl = await this.payments.create(order);
    await this.db.query("UPDATE union_orders SET code_url=$2 WHERE id=$1 AND status='pending'", [orderId, codeUrl]);
    return this.order(userId, orderId);
  }
  async order(userId, orderId) {
    const order = row(await this.db.query('SELECT * FROM union_orders WHERE id=$1 AND central_user_id=$2', [orderId, userId]));
    insist(order, 404, 'order_not_found', '订单不存在');
    return order;
  }
  async acceptPayment({ orderId, transactionId, amountCents, currency, paidAt }) {
    this.assertTransactionsAllowed();
    insist(transactionId && Number.isFinite(paidAt), 400, 'invalid_payment', '支付凭证无效');
    await this.db.transaction(async tx => {
      const unlocked = row(await tx.query('SELECT central_user_id FROM union_orders WHERE id=$1', [orderId]));
      insist(unlocked, 404, 'order_not_found', '订单不存在');
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [unlocked.central_user_id]);
      const order = row(await tx.query('SELECT * FROM union_orders WHERE id=$1 FOR UPDATE', [orderId]));
      insist(order.amount_cents === amountCents && currency === 'CNY', 409, 'amount_mismatch', '支付金额或币种不匹配');
      if (order.provider_ref) { insist(order.provider_ref === transactionId, 409, 'transaction_conflict', '订单交易凭证冲突'); return; }
      const existing = row(await tx.query('SELECT * FROM union_memberships WHERE central_user_id=$1 FOR UPDATE', [order.central_user_id]));
      insist(!existing || existing.status === 'expired' || (existing.status !== 'restoring' && Number(existing.expires_at) > this.now()), 409, 'restoration_pending', '等待原会员恢复后继续处理支付');
      const continuing = existing && Number(existing.expires_at) > this.now() && ['active', 'activating'].includes(existing.status);
      const membershipId = existing?.id || id('um');
      const startsAt = continuing ? Number(existing.expires_at) : paidAt;
      const endsAt = addMonths(startsAt, order.snapshot.plan.months);
      const revision = (existing?.revision || 0) + 1;
      const contracts = continuing ? existing.contracts : order.snapshot.contracts;
      const windowSnapshot = { ...order.snapshot, window: { membershipId, startsAt, endsAt, continuing: Boolean(continuing) } };
      await tx.query(`INSERT INTO union_memberships(id,central_user_id,status,starts_at,expires_at,contracts,revision) VALUES($1,$2,'activating',$3,$4,$5,$6)
        ON CONFLICT(central_user_id) DO UPDATE SET status='activating',starts_at=EXCLUDED.starts_at,expires_at=EXCLUDED.expires_at,contracts=EXCLUDED.contracts,revision=EXCLUDED.revision`, [membershipId, order.central_user_id, continuing ? Number(existing.starts_at) : startsAt, endsAt, JSON.stringify(contracts), revision]);
      await tx.query("UPDATE union_orders SET status='paid',provider_ref=$2,paid_at=$3,snapshot=$4 WHERE id=$1", [orderId, transactionId, paidAt, windowSnapshot]);
      await tx.query("INSERT INTO union_receipts(id,central_user_id,product_id,order_id,kind,amount_cents,occurred_at,is_test) VALUES($1,$2,'union',$3,'payment',$4,$5,$6) ON CONFLICT DO NOTHING", [`union-payment:${orderId}`, order.central_user_id, orderId, amountCents, paidAt, order.is_test]);
      for (const contract of contracts) {
        const action = continuing ? 'extend' : 'activate';
        await this.enqueue(tx, `${orderId}:${contract.id}:${action}`, membershipId, orderId, contract.id, action, { centralUserId: order.central_user_id, membershipId, revision, startsAt, expiresAt: endsAt, contract }, paidAt);
        for (const [index, grant] of grantSchedule(contract, order.plan_id, startsAt, endsAt).entries()) {
          await this.enqueue(tx, `${orderId}:${contract.id}:grant:${index}`, membershipId, orderId, contract.id, 'grant', { centralUserId: order.central_user_id, membershipId, orderId, planId: order.plan_id, ...grant }, grant.at);
        }
      }
    });
  }
  async enqueue(tx, taskId, membershipId, orderId, productId, action, payload, dueAt) {
    this.assertTransactionsAllowed();
    await tx.query('INSERT INTO union_tasks(id,membership_id,order_id,product_id,action,payload,due_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [taskId, membershipId, orderId, productId, action, payload, dueAt]);
  }
  async recordEvent(userId, productId, name, context, eventId = id('ue'), occurredAt = this.now()) {
    const websiteEvent = productId === 'website' && context?.entry === 'website' && ['center_viewed', 'plan_selected', 'checkout_started'].includes(name);
    insist(EVENT_NAMES.includes(name) && (PRODUCT_IDS.includes(productId) || websiteEvent), 400, 'invalid_event', '事件无效');
    insist(Number.isSafeInteger(occurredAt) && occurredAt <= this.now() + 300_000, 400, 'invalid_event_time', '事件时间无效');
    const assignment = await this.assignment(userId);
    if (!assignment || occurredAt < Number(assignment.enrolled_at)) return;
    const allowed = Object.fromEntries(Object.entries(context || {}).filter(([key, value]) => ['entry', 'planId', 'orderId', 'operation', 'outcome'].includes(key) && typeof value === 'string' && value.length <= 100));
    await this.db.query('INSERT INTO union_events(id,central_user_id,experiment_version,variant,product_id,name,context,occurred_at,is_test) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING', [eventId, userId, assignment.experiment_version, assignment.variant, productId, name, allowed, occurredAt, assignment.is_test]);
  }
  async status(userId) {
    if (this.entryTesting()) return null;
    const member = await this.membership(userId);
    if (!member) return null;
    const tasks = (await this.db.query("SELECT product_id,action,status,attempts,payload FROM union_tasks WHERE membership_id=$1 ORDER BY due_at,id", [member.id])).rows.filter(task => task.action !== 'grant' || (task.payload.at <= this.now() && task.payload.expiresAt > this.now()));
    let snapshots = {};
    try { snapshots = await this.adapters.snapshots(userId, { partial: true }); } catch { /* Preserve membership visibility when a product's balance endpoint is unavailable. */ }
    return { id: member.id, status: member.status, startsAt: Number(member.starts_at), expiresAt: Number(member.expires_at), products: member.contracts.map(contract => ({ id: contract.id, name: contract.name, url: contract.url, tierName: contract.effectiveTierName, previous: contract.previous, remainingQuota: snapshots[contract.id]?.remainingQuota || null, operations: tasks.filter(task => task.product_id === contract.id).map(({payload,...task}) => task) })) };
  }
  async runWorker() {
    if (this.entryTesting()) return;
    await this.scheduleRestoration();
    for (let count = 0; count < 100; count++) {
      const task = await this.db.transaction(async tx => row(await tx.query(`UPDATE union_tasks SET status='running',lease_until=$2,attempts=attempts+1 WHERE id=(
        SELECT t.id FROM union_tasks t WHERE t.due_at <= $1 AND (t.status='pending' OR (t.status='running' AND t.lease_until<$1))
        AND NOT EXISTS (SELECT 1 FROM union_tasks other WHERE other.membership_id=t.membership_id AND other.product_id=t.product_id AND other.status='running' AND other.lease_until >= $1)
        ORDER BY t.due_at, CASE t.action WHEN 'activate' THEN 0 WHEN 'extend' THEN 0 WHEN 'grant' THEN 1 ELSE 2 END FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`, [this.now(), this.now() + 30_000])));
      if (!task) break;
      try {
        const member = row(await this.db.query('SELECT * FROM union_memberships WHERE id=$1', [task.membership_id]));
        const obsoleteTask = (task.action === 'grant' && task.payload.expiresAt <= this.now()) || (['activate','extend','grant'].includes(task.action) && ['restoring','expired'].includes(member.status));
        if (!obsoleteTask) {
          if (task.action === 'grant') {
            const activated = row(await this.db.query("SELECT 1 FROM union_tasks WHERE order_id=$1 AND product_id=$2 AND action IN ('activate','extend') AND status='done'", [task.order_id, task.product_id]));
            insist(activated, 409, 'activation_pending', '等待产品开通');
          }
          await this.adapters.call(task.product_id, task.action, { ...task.payload, operationId: task.id });
        }
        await this.db.query("UPDATE union_tasks SET status='done',completed_at=$2,lease_until=NULL,last_error=NULL WHERE id=$1", [task.id, this.now()]);
      } catch {
        // Operational logs contain identifiers only; snapshots can contain private account information.
        await this.db.query("UPDATE union_tasks SET status='pending',lease_until=NULL,due_at=$2,last_error='product_operation_failed' WHERE id=$1", [task.id, this.now() + Math.min(300_000, 1000 * 2 ** Math.min(task.attempts, 8))]);
        if (task.attempts >= 3) console.error(JSON.stringify({ event: 'union_entitlement_retry', taskId: task.id, productId: task.product_id, attempts: task.attempts }));
      }
    }
    await this.db.query(`UPDATE union_memberships m SET status='active' WHERE status='activating' AND NOT EXISTS(SELECT 1 FROM union_tasks t WHERE t.membership_id=m.id AND t.status<>'done' AND (t.action IN ('activate','extend','revoke') OR (t.action='grant' AND (t.payload->>'at')::bigint <= $1 AND (t.payload->>'expiresAt')::bigint > $1)))`, [this.now()]);
    await this.db.query(`UPDATE union_memberships m SET status='expired' WHERE status='restoring' AND NOT EXISTS(SELECT 1 FROM union_tasks t WHERE t.membership_id=m.id AND t.action IN ('restore','revoke') AND t.status<>'done')`);
  }
  async scheduleRestoration() {
    if (this.entryTesting()) return;
    const expired = (await this.db.query("SELECT * FROM union_memberships WHERE expires_at <= $1 AND status IN ('active','activating')", [this.now()])).rows;
    for (const member of expired) await this.db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [member.central_user_id]);
      const current = row(await tx.query('SELECT * FROM union_memberships WHERE id=$1 FOR UPDATE', [member.id]));
      if (Number(current.expires_at) > this.now() || current.status === 'restoring' || current.status === 'expired') return;
      await tx.query("UPDATE union_memberships SET status='restoring' WHERE id=$1", [member.id]);
      for (const contract of current.contracts) await this.enqueue(tx, `${member.id}:restore:${current.revision}:${contract.id}`, member.id, null, contract.id, 'restore', { centralUserId: member.central_user_id, membershipId: member.id, revision: current.revision, expiredAt: Number(current.expires_at) }, this.now());
    });
  }
  async prepareRefund(orderId, actor) {
    this.assertTransactionsAllowed();
    const refund = await this.db.transaction(async tx => {
      const identity = row(await tx.query('SELECT central_user_id FROM union_orders WHERE id=$1', [orderId]));
      insist(identity, 404, 'order_not_found', '订单不存在');
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [identity.central_user_id]);
      const order = row(await tx.query('SELECT * FROM union_orders WHERE id=$1 FOR UPDATE', [orderId]));
      insist(order && ['paid','refunding'].includes(order.status), 409, 'refund_unavailable', '仅支持已支付的联合会员整单退款');
      const existing = row(await tx.query('SELECT * FROM union_refunds WHERE order_id=$1', [orderId]));
      if (existing) return existing;
      insist(!(await tx.query("SELECT 1 FROM union_orders WHERE central_user_id=$1 AND status='pending'", [order.central_user_id])).rowCount, 409, 'pending_order', '请先关闭待支付的续期订单');
      const newer = await tx.query("SELECT 1 FROM union_orders WHERE central_user_id=$1 AND status IN ('paid','refunding') AND paid_at>$2", [order.central_user_id, order.paid_at]);
      insist(!newer.rowCount, 409, 'newer_order_exists', '请先处理后续续期订单的退款');
      await tx.query("UPDATE union_orders SET status='refunding' WHERE id=$1", [orderId]);
      await tx.query('INSERT INTO union_audit(actor,action,target,occurred_at) VALUES($1,$2,$3,$4)', [actor, 'refund_approved', orderId, this.now()]);
      return row(await tx.query("INSERT INTO union_refunds(id,order_id,status,actor,created_at) VALUES($1,$2,'requested',$3,$4) RETURNING *", [id('ur'), orderId, actor, this.now()]));
    });
    const order = row(await this.db.query('SELECT * FROM union_orders WHERE id=$1', [orderId]));
    try {
      const result = await this.payments.refund(refund, order);
      await this.db.query("UPDATE union_refunds SET status='processing' WHERE id=$1 AND status='requested'", [refund.id]);
      if (result.status === 'SUCCESS') await this.acceptRefund({ ...result, refund_status: 'SUCCESS', mchid: this.payments.config.mchId, out_refund_no: refund.id });
    } catch { /* An unknown provider outcome must be reconciled with the same refund id. */ }
    return { id: refund.id, status: (await this.db.query('SELECT status FROM union_refunds WHERE id=$1', [refund.id])).rows[0].status };
  }
  async reconcileRefunds() {
    if (this.entryTesting()) return;
    const refunds = (await this.db.query("SELECT * FROM union_refunds WHERE status IN ('requested','processing') ORDER BY created_at LIMIT 20")).rows;
    for (const refund of refunds) {
      try {
        const result = await this.payments.queryRefund(refund.id);
        if (result.status === 'SUCCESS') await this.acceptRefund({ ...result, refund_status: 'SUCCESS', mchid: this.payments.config.mchId, out_refund_no: refund.id });
        else if (result.status === 'CLOSED' || result.status === 'ABNORMAL') await this.db.query("UPDATE union_refunds SET status='failed' WHERE id=$1", [refund.id]);
      } catch { /* Retain requested/processing when the provider outcome is unknown. */ }
    }
  }
  async reconcilePayments() {
    if (this.entryTesting()) return;
    const orders = (await this.db.query("SELECT * FROM union_orders WHERE status='pending' ORDER BY created_at LIMIT 20")).rows;
    for (const order of orders) {
      try {
        const remote = await this.payments.query(order.id);
        if (remote.trade_state === 'SUCCESS') await this.acceptPayment(this.payments.payment(remote));
        else if (remote.trade_state === 'CLOSED') await this.db.query("UPDATE union_orders SET status='closed' WHERE id=$1 AND status='pending'", [order.id]);
        else if (Number(order.expires_at) <= this.now()) {
          await this.payments.close(order.id);
          await this.db.query("UPDATE union_orders SET status='closed' WHERE id=$1 AND status='pending'", [order.id]);
        }
      } catch { /* Keep the pending order until the provider outcome is known. */ }
    }
  }
  async acceptRefund(event) {
    this.assertTransactionsAllowed();
    insist(event.refund_status === 'SUCCESS' && event.mchid === this.payments.config.mchId, 400, 'refund_invalid', '退款通知无效');
    await this.db.transaction(async tx => {
      const initial = row(await tx.query('SELECT o.central_user_id FROM union_refunds r JOIN union_orders o ON o.id=r.order_id WHERE r.id=$1', [event.out_refund_no]));
      insist(initial, 404, 'refund_not_found', '退款不存在');
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [initial.central_user_id]);
      const refund = row(await tx.query('SELECT * FROM union_refunds WHERE id=$1 FOR UPDATE', [event.out_refund_no]));
      const order = row(await tx.query('SELECT * FROM union_orders WHERE id=$1 FOR UPDATE', [refund.order_id]));
      insist(event.out_trade_no === order.id && event.transaction_id === order.provider_ref && event.amount?.refund === order.amount_cents && event.amount?.total === order.amount_cents && (!event.amount.currency || event.amount.currency === 'CNY'), 409, 'refund_mismatch', '退款金额或原交易不匹配');
      if (refund.status === 'succeeded') return;
      const member = row(await tx.query('SELECT * FROM union_memberships WHERE central_user_id=$1 FOR UPDATE', [order.central_user_id]));
      await tx.query("UPDATE union_refunds SET status='succeeded',completed_at=$2 WHERE id=$1", [refund.id, this.now()]);
      await tx.query("UPDATE union_orders SET status='refunded' WHERE id=$1", [order.id]);
      await tx.query("INSERT INTO union_receipts(id,central_user_id,product_id,order_id,kind,amount_cents,occurred_at,is_test) VALUES($1,$2,'union',$3,'refund',$4,$5,$6) ON CONFLICT DO NOTHING", [`union-refund:${order.id}`, order.central_user_id, order.id, order.amount_cents, this.now(), order.is_test]);
      await tx.query("UPDATE union_tasks SET status='done',completed_at=$2,last_error='refunded' WHERE order_id=$1 AND status='pending'", [order.id, this.now()]);
      const remaining = (await tx.query("SELECT snapshot FROM union_orders WHERE central_user_id=$1 AND status='paid' ORDER BY paid_at DESC LIMIT 1", [order.central_user_id])).rows[0];
      const endsAt = remaining?.snapshot?.window?.endsAt || this.now();
      const revision = member.revision + 1;
      const restoring = endsAt <= this.now();
      await tx.query('UPDATE union_memberships SET expires_at=$2,status=$3,revision=$4 WHERE id=$1', [member.id, endsAt, restoring ? 'restoring' : 'activating', revision]);
      for (const contract of member.contracts) {
        await this.enqueue(tx, `${refund.id}:${contract.id}:revoke`, member.id, order.id, contract.id, 'revoke', { centralUserId: order.central_user_id, membershipId: member.id, orderId: order.id, revision, expiresAt: endsAt }, this.now());
        await this.enqueue(tx, `${refund.id}:${contract.id}:${restoring ? 'restore' : 'extend'}`, member.id, order.id, contract.id, restoring ? 'restore' : 'extend', { centralUserId: order.central_user_id, membershipId: member.id, revision, startsAt: Number(member.starts_at), expiresAt: endsAt, expiredAt: endsAt, contract }, this.now() + 1);
      }
    });
  }
  async report() {
    const users = (await this.db.query(`SELECT a.variant,a.enrolled_at,
      COALESCE((SELECT SUM(CASE r.kind WHEN 'payment' THEN r.amount_cents WHEN 'refund' THEN -r.amount_cents ELSE 0 END) FROM union_receipts r WHERE r.central_user_id=a.central_user_id AND NOT r.is_test AND r.occurred_at>=a.enrolled_at AND r.occurred_at<a.enrolled_at+604800000),0)::float8 AS revenue,
      COALESCE((SELECT SUM(r.amount_cents) FROM union_receipts r WHERE r.central_user_id=a.central_user_id AND NOT r.is_test AND r.kind='cost' AND r.occurred_at>=a.enrolled_at AND r.occurred_at<a.enrolled_at+604800000),0)::float8 AS cost,
      (SELECT COUNT(*) FROM union_events e WHERE e.central_user_id=a.central_user_id AND e.name='cost_unavailable' AND NOT e.is_test AND e.occurred_at>=a.enrolled_at AND e.occurred_at<a.enrolled_at+604800000)::integer AS missing_costs,
      (SELECT COUNT(DISTINCT e.product_id) FROM union_events e WHERE e.central_user_id=a.central_user_id AND e.name='core_task_completed' AND NOT e.is_test AND e.occurred_at>=a.enrolled_at AND e.occurred_at<a.enrolled_at+604800000)::integer AS products
      FROM union_assignments a WHERE a.experiment_version=$1 AND NOT a.is_test AND a.enrolled_at<=$2`, [this.config.version, this.now() - 604800000])).rows;
    const group = variant => {
      const values = users.filter(user => user.variant === variant), n = values.length;
      const total = values.reduce((sum, user) => sum + user.revenue, 0), mean = n ? total / n : null;
      const variance = n > 1 ? values.reduce((sum, user) => sum + (user.revenue - mean) ** 2, 0) / (n - 1) : null;
      const missingCostEvents=values.reduce((sum,user)=>sum+user.missing_costs,0),cost=values.reduce((sum,user)=>sum+user.cost,0);
      return { users: n, netRevenueCents: total, missingCostEvents, estimatedContributionCents:this.catalog.costApproved&&this.catalog.products.every(p=>p.verified)&&!missingCostEvents?total-cost:null, revenuePerUserCents: mean, costCents: values.reduce((sum, user) => sum + user.cost, 0), crossProductUsers: values.filter(user => user.products >= 2).length, variance };
    };
    const A = group('A'), B = group('B');
    const samplePerGroup = A.revenuePerUserCents > 0 && A.variance !== null ? Math.ceil(2 * (1.96 + 0.8416) ** 2 * A.variance / (0.1 * A.revenuePerUserCents) ** 2) : null;
    return { version: this.config.version, windowDays: 7, groups: { A, B }, samplePerGroup, status: '需按预注册周期、样本量和 30 天退款复查后判读', pendingTasks: Number(row(await this.db.query("SELECT count(*) FROM union_tasks WHERE status<>'done'" )).count) };
  }
}
