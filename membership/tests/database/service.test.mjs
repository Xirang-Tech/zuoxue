import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../../server/database.mjs';
import { migrate } from '../../scripts/migrate.mjs';
import { MembershipService } from '../../server/service.mjs';
import { PRODUCT_IDS, assignVariant } from '../../shared/domain.mjs';
const connection = process.env.TEST_DATABASE_URL;
if (connection && !['127.0.0.1','localhost'].includes(new URL(connection).hostname)) throw new Error('测试只允许连接本机隔离数据库');
const root = connection ? new Database(connection) : null;
after(async () => { await root?.close(); });
const config = () => ({version:'test-v1',salt:'isolated-test-salt',experimentEnabled:true,salesEnabled:true});
function user(variant = 'B', prefix = '') { for (let i=0;;i++) if (assignVariant(`${prefix}user-${i}`,'test-v1','isolated-test-salt') === variant) return `${prefix}user-${i}`; }
async function setup(t) {
  const schema = `union_test_${randomUUID().replaceAll('-','')}`;
  await root.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(connection); url.searchParams.set('options',`-c search_path=${schema}`);
  const db = new Database(url.href); await migrate(db);
  t.after(async () => {await db.close();await root.query(`DROP SCHEMA ${schema} CASCADE`);});
  const catalog = {version:'approved-v1',approved:true,costApproved:true,currency:'CNY',plans:[{id:'monthly',name:'月卡',months:1,priceCents:14900},{id:'yearly',name:'年卡',months:12,priceCents:129900}],products:PRODUCT_IDS.map(id => ({id,name:id,tierId:'pro',tierName:'专业版',tierRank:1,verified:true,grants:{monthly:[{unit:'credits',amount:800,schedule:'monthly'}],yearly:[{unit:'credits',amount:800,schedule:'monthly'}]}}))};
  const calls = [], snapshots = Object.fromEntries(PRODUCT_IDS.map(id => [id,{ready:true,autoRenewActive:false,pendingSubscriptionOrder:false,pendingReservations:0,tierId:'free',tierRank:0,remainingMs:0,snapshotVersion:'1'}]));
  const failing = new Set();
  const adapters = {configured:() => true,snapshots:async () => structuredClone(snapshots),call:async (productId,action,payload) => {if(failing.has(`${productId}:${action}`)) throw new Error('unavailable'); calls.push({productId,action,payload});return {ok:true};}};
  const payments = {ready:() => true,config:{mchId:'mch'},create:async () => 'weixin://wxpay/test',refund:async () => ({status:'PROCESSING'})};
  let now = Date.parse('2026-01-31T12:00:00Z');
  const service = new MembershipService({db,catalog,adapters,payments,config:config(),now:() => now});
  const central = user(); await service.enroll(central,'aipm',{baselineStatus:'free'});
  async function order(plan = 'monthly', account = central, key = randomUUID()) {const quote = await service.quote(account,plan);return service.createOrder(account,quote.id,key,{productId:'aipm',entry:'paywall',returnUrl:'https://workbench.zuoxue.com/#create'});}
  async function pay(order) {await service.acceptPayment({orderId:order.id,transactionId:`wx-${order.id}`,amountCents:order.amount_cents,currency:'CNY',paidAt:now});}
  return {db,catalog,calls,snapshots,failing,service,central,order,pay,advance:ms => now+=ms,now:() => now};
}
const dbTest = (name, fn) => test(name,{skip:!connection},fn);
dbTest('assignments remain stable across product entry points',async t => {
  const x=await setup(t); await x.service.enroll(x.central,'workflow');
  const assignment=await x.service.assignment(x.central); assert.equal(assignment.first_product,'aipm'); assert.equal(assignment.variant,'B');
});
dbTest('control users cannot create a quote or purchase through a direct link',async t => {
  const x=await setup(t), account=user('A'); await x.service.enroll(account,'keban');
  assert.equal((await x.service.offers(account)).catalog,null);
  await assert.rejects(x.service.quote(account,'monthly'),{code:'sale_unavailable'});
});
dbTest('price and cost review gates cannot be bypassed',async t => {
  const x=await setup(t); x.catalog.costApproved=false;
  await assert.rejects(x.order(),{code:'sale_unavailable'});
});
dbTest('concurrent checkout retries produce one order and enforce ownership',async t => {
  const x=await setup(t), quote=await x.service.quote(x.central,'monthly'), key=randomUUID();
  const [a,b]=await Promise.all([x.service.createOrder(x.central,quote.id,key),x.service.createOrder(x.central,quote.id,key)]);
  assert.equal(a.id,b.id); assert.equal(Number((await x.db.query('SELECT count(*) FROM union_orders')).rows[0].count),1);
  await assert.rejects(x.service.order('someone-else',a.id),{code:'order_not_found'});
});
dbTest('website order attribution uses the trusted website rather than a product or arbitrary return address',async t => {
  const x=await setup(t), quote=await x.service.quote(x.central,'monthly');
  const order=await x.service.createOrder(x.central,quote.id,randomUUID(),{entry:'website',returnUrl:'https://evil.example/'});
  assert.deepEqual(order.attribution,{productId:'website',entry:'website',returnUrl:'https://zuoxue.com/'});
});
dbTest('signed payment duplicates grant each product and each allowance only once',async t => {
  const x=await setup(t), order=await x.order(); await Promise.all([x.pay(order),x.pay(order)]); await x.service.runWorker(); await x.service.runWorker();
  assert.equal(x.calls.filter(call => call.action==='activate').length,5); assert.equal(x.calls.filter(call => call.action==='grant').length,5);
  assert.equal((await x.service.status(x.central)).status,'active');
  assert.equal(Number((await x.db.query('SELECT count(*) FROM union_receipts')).rows[0].count),1);
});
dbTest('wrong amount and currency never issue an entitlement',async t => {
  const x=await setup(t), order=await x.order();
  await assert.rejects(x.service.acceptPayment({orderId:order.id,transactionId:'wx-bad',amountCents:1,currency:'CNY',paidAt:x.now()}),{code:'amount_mismatch'});
  await assert.rejects(x.service.acceptPayment({orderId:order.id,transactionId:'wx-bad',amountCents:order.amount_cents,currency:'USD',paidAt:x.now()}),{code:'amount_mismatch'});
  assert.equal((await x.service.status(x.central)),null);
});
dbTest('higher-tier membership and old quota survive in an immutable paid snapshot',async t => {
  const x=await setup(t); x.snapshots.aipm={ready:true,autoRenewActive:false,pendingSubscriptionOrder:false,pendingReservations:0,tierId:'max',tierName:'旗舰版',tierRank:2,remainingMs:20*86400000,remainingQuota:{credits:123},snapshotVersion:'2',highTierVerified:true,highTierGrants:{monthly:[{unit:'credits',amount:2800,schedule:'monthly'}],yearly:[{unit:'credits',amount:2800,schedule:'monthly'}]}};
  const order=await x.order(); x.catalog.products.find(p=>p.id==='aipm').tierName='changed'; await x.pay(order); await x.service.runWorker();
  const contract=(await x.service.membership(x.central)).contracts.find(p=>p.id==='aipm');
  assert.equal(contract.effectiveTierId,'max'); assert.equal(contract.previous.remainingQuota.credits,123); assert.equal(contract.previous.remainingMs,20*86400000);
  assert.equal(x.calls.find(call=>call.productId==='aipm'&&call.action==='grant').payload.amount,2800);
});
dbTest('a failed product remains visibly pending and blocks its quota until retry succeeds',async t => {
  const x=await setup(t); x.failing.add('workflow:activate'); const order=await x.order(); await x.pay(order); await x.service.runWorker();
  assert.equal((await x.service.status(x.central)).status,'activating'); assert.equal(x.calls.filter(call=>call.productId==='workflow'&&call.action==='grant').length,0);
  x.failing.clear(); x.advance(10000); await x.service.runWorker();
  assert.equal((await x.service.status(x.central)).status,'active'); assert.equal(x.calls.filter(call=>call.productId==='workflow'&&call.action==='grant').length,1);
});
dbTest('yearly grants remain scheduled and renewing early does not reset current quota',async t => {
  const x=await setup(t), first=await x.order('yearly'); await x.pay(first); await x.service.runWorker();
  assert.equal(x.calls.filter(call=>call.action==='grant').length,5);
  const renewed=await x.order('monthly'); await x.pay(renewed); await x.service.runWorker();
  assert.equal(x.calls.filter(call=>call.action==='grant').length,5);
  const member=await x.service.membership(x.central); assert.equal(new Date(Number(member.expires_at)).toISOString(),'2027-02-28T12:00:00.000Z');
});
dbTest('stopping new sales preserves paid entitlements and expiry restores old memberships once',async t => {
  const x=await setup(t), order=await x.order(); await x.pay(order); x.service.config.salesEnabled=false; x.service.config.experimentEnabled=false; await x.service.runWorker();
  assert.equal((await x.service.eligibility(x.central)).visible,true); await assert.rejects(x.order(),{code:'sale_unavailable'});
  x.advance(40*86400000); await x.service.runWorker(); await x.service.runWorker(); assert.equal(x.calls.filter(call=>call.action==='restore').length,5); assert.equal((await x.service.status(x.central)).status,'expired');
});
dbTest('active auto-renew and unsettled generation prevent new purchases',async t => {
  const x=await setup(t); x.snapshots.keban.autoRenewActive=true; await assert.rejects(x.order(),{code:'auto_renew_active'});
  x.snapshots.keban.autoRenewActive=false; x.snapshots.aipm.pendingReservations=1; await assert.rejects(x.order(),{code:'generation_in_progress'});
});
dbTest('whole-order refunds revoke unused union benefits and restore original membership idempotently',async t => {
  const x=await setup(t), order=await x.order(); await x.pay(order); await x.service.runWorker();
  const refund=await x.service.prepareRefund(order.id,'test-operator');
  const event={out_refund_no:refund.id,mchid:'mch',refund_status:'SUCCESS',out_trade_no:order.id,transaction_id:`wx-${order.id}`,amount:{refund:order.amount_cents,total:order.amount_cents,currency:'CNY'}};
  await x.service.acceptRefund(event); await x.service.acceptRefund(event); x.advance(5); await x.service.runWorker();
  assert.equal(x.calls.filter(call=>call.action==='revoke').length,5); assert.equal(x.calls.filter(call=>call.action==='restore').length,5);
  assert.equal((await x.service.status(x.central)).status,'expired');
});
dbTest('a failed first quota grant never appears as fully activated',async t => {
  const x=await setup(t);x.failing.add('workflow:grant');const order=await x.order();await x.pay(order);await x.service.runWorker();
  const status=await x.service.status(x.central);assert.equal(status.status,'activating');assert(status.products.find(p=>p.id==='workflow').operations.some(op=>op.action==='grant'&&op.status!=='done'));
  x.failing.clear();x.advance(10000);await x.service.runWorker();assert.equal((await x.service.status(x.central)).status,'active');
});
dbTest('a pending refund blocks renewal quotes and previously issued renewal quotes',async t => {
  const x=await setup(t),order=await x.order();await x.pay(order);await x.service.runWorker();
  const quote=await x.service.quote(x.central,'monthly');await x.service.prepareRefund(order.id,'test-operator');
  await assert.rejects(x.service.quote(x.central,'monthly'),{code:'refund_processing'});
  await assert.rejects(x.service.createOrder(x.central,quote.id,randomUUID()),{code:'refund_processing'});
});
dbTest('report includes zero-paying accounts, all product revenue and excludes test receipts',async t => {
  const x=await setup(t),control=user('A');await x.service.enroll(control,'keban');
  await x.db.query("INSERT INTO union_receipts(id,central_user_id,product_id,order_id,kind,amount_cents,occurred_at,is_test) VALUES('real',$1,'aipm','single-1','payment',6900,$2,false),('test',$1,'aipm','single-2','payment',999999,$2,true)",[x.central,x.now()+1000]);
  x.advance(8*86400000);const report=await x.service.report();assert.equal(report.groups.A.users,1);assert.equal(report.groups.A.revenuePerUserCents,0);assert.equal(report.groups.B.netRevenueCents,6900);
});
dbTest('prelaunch visits do not start the experiment observation window',async t=>{
  const x=await setup(t),account=user('B','prelaunch-');x.service.config.experimentEnabled=false;
  await x.service.enroll(account,'keban');assert.equal(await x.service.assignment(account),undefined);
  x.advance(86400000);x.service.config.experimentEnabled=true;await x.service.enroll(account,'keban');
  assert.equal(Number((await x.service.assignment(account)).enrolled_at),x.now());
});
dbTest('native pending subscription orders are rejected before taking payment', async t => {
  const x=await setup(t);x.snapshots.pattern.pendingSubscriptionOrder=true;
  await assert.rejects(x.order(), {code:'native_order_pending'});
});
dbTest('an order paid across expiry waits for complete native restoration before starting a fresh freeze', async t => {
  const x=await setup(t), first=await x.order();await x.pay(first);await x.service.runWorker();
  const renewal=await x.order();x.advance(40*86400000);
  await assert.rejects(x.pay(renewal), {code:'restoration_pending'});
  await assert.rejects(x.order(), {code:'restoration_pending'});
  await x.service.runWorker();
  assert.equal((await x.service.status(x.central)).status,'expired');
  await x.pay(renewal);await x.service.runWorker();
  assert.equal((await x.service.status(x.central)).status,'active');
  assert.equal(x.calls.filter(c=>c.action==='activate').length,10);
});
dbTest('delayed core telemetry keeps the actual task date within the cohort window', async t => {
  const x=await setup(t), actual=x.now()+3600000;x.advance(9*86400000);
  await x.service.recordEvent(x.central,'pattern','core_task_completed',{},'native-core',actual);
  const saved=(await x.db.query("SELECT occurred_at FROM union_events WHERE id='native-core'")).rows[0];
  assert.equal(Number(saved.occurred_at),actual);
});

dbTest('missing upstream cost is surfaced and never treated as a zero-cost contribution',async t=>{
 const x=await setup(t);await x.service.recordEvent(x.central,'workflow','cost_unavailable',{},'missing-cost');x.advance(8*86400000);
 const report=await x.service.report();assert.equal(report.groups.B.missingCostEvents,1);assert.equal(report.groups.B.estimatedContributionCents,null);
});
