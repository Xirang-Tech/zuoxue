import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planQuota, productProgress, membershipView, orderView, quotaText } from '../public/member-view.js';
import { createPreviewFixture, SCENARIOS } from '../server/preview-fixture.mjs';
const catalog = JSON.parse(await readFile(new URL('../config/catalog.json',import.meta.url),'utf8'));
const preview = JSON.parse(await readFile(new URL('../config/preview.json',import.meta.url),'utf8'));
const now = Date.parse('2026-11-03T04:00:00Z');
const fixture = createPreviewFixture(catalog, preview, () => now);

test('preview prices never mutate or approve the real sales catalog', async () => {
  const offer = await fixture.service.offers('unpaid:monthly');
  assert.deepEqual(offer.catalog.plans.map(plan => plan.priceCents),[9900,79900]);
  assert.deepEqual(catalog.plans.map(plan => plan.priceCents),[null,null]);
  assert.equal(offer.catalog.approved,false); assert.equal(offer.catalog.costApproved,false);
  assert.deepEqual((await fixture.service.offers('unpriced:monthly')).catalog.plans.map(plan => plan.priceCents),[null,null]);
  assert.equal((await fixture.service.offers('control:monthly')).purchasable,false);
  assert.equal((await fixture.service.offers('control:monthly')).catalog,null);
});
test('plan summaries distinguish upfront annual transcription and monthly expiring grants', () => {
  const keban = catalog.products.find(p => p.id === 'keban');
  assert.match(planQuota(keban,'monthly'),/30 小时.*当期结束失效/);
  assert.equal(planQuota(keban,'yearly'),'400 小时转写 · 一次到账 · 全年可用');
  assert.doesNotMatch(planQuota(keban,'monthly'),/400/);
  assert.match(planQuota(catalog.products.find(p => p.id === 'pattern'),'yearly'),/最多 6 个.*30 次.*当期结束失效/);
  assert.equal(planQuota(catalog.products.find(p => p.id === 'aipm'),'yearly'),'800 点／会员月 · 按月到账 · 当期结束失效');
  assert.equal(planQuota(catalog.products.find(p => p.id === 'aiprd'),'monthly'),'功能与积分待产品方确认');
  assert.match(quotaText({ credits:0, transcription_seconds:3600 }),/套餐点数 0.*1 小时/);
});
test('all preview states expose realistic existing order and membership shapes', async () => {
  for (const [scenario] of SCENARIOS) {
    const offer = await fixture.service.offers(`${scenario}:yearly`);
    assert.equal(typeof offer.visible,'boolean',scenario);
    const member = await fixture.service.status(`${scenario}:yearly`);
    if (member) assert.equal(member.products.length,5,scenario);
  }
  const quote = await fixture.service.quote('unpaid:monthly','yearly');
  assert.equal(quote.plan.priceCents,79900);
  const aipm = quote.contracts.find(p => p.id === 'aipm');
  assert.equal(aipm.effectiveTierName,'旗舰版'); assert.equal(aipm.previous.remainingMs,20*86400000);
  assert.equal(aipm.grants.yearly[0].amount,2800);
  await assert.rejects(fixture.service.createOrder(),/不能创建真实订单/);
});
test('payment confirmation is separate from completion, and retry state names the pending product', async () => {
  const activating = await fixture.service.status('activating:monthly');
  const view = membershipView(activating,null,now);
  assert.equal(view.completed,2); assert.equal(view.ready,false); assert.match(view.description,/2／5/);
  const partial = await fixture.service.status('partial:monthly');
  const partialView = membershipView(partial,null,now);
  assert.equal(partialView.completed,4); assert.equal(partialView.tone,'warning');
  assert.equal(productProgress(partial,partial.products.find(p => p.id === 'workflow'),now).retrying,true);
  const active = await fixture.service.status('active:monthly');
  assert.equal(membershipView(active,null,now).ready,true);
  assert.equal(membershipView({...active,products:active.products.slice(0,4)},null,now).ready,false);
  assert.equal(active.products.find(p => p.id === 'pattern').remainingQuota,null);
});
test('time-based expiry cannot be displayed as active before the restoration worker runs', async () => {
  const member = await fixture.service.status('expired:monthly');
  assert.equal(member.status,'active');
  const view = membershipView(member,null,now);
  assert.match(view.title,/已到期/); assert.equal(view.ready,false);
  assert.equal(productProgress(member,member.products[0],now).ready,false);
  const restoring = await fixture.service.status('restoring:monthly');
  assert.equal(membershipView(restoring,null,now).completed,3);
  assert.equal(productProgress(restoring,restoring.products[0],now).label,'联合权益已结束');
  assert.equal(productProgress(restoring,restoring.products[2],now).label,'原会员已恢复');
  const restored = await fixture.service.status('restored:monthly');
  assert.equal(membershipView(restored,null,now).ready,true);
  assert.equal(restored.products.find(p => p.id === 'aipm').tierName,'旗舰版');
});
test('refund confirmation never implies restoration has already completed', async () => {
  const refunded = await fixture.service.order('refunded:monthly');
  const restoring = await fixture.service.status('refunded:monthly');
  assert.match(orderView(refunded,now).title,/已退款/);
  assert.equal(membershipView(restoring,refunded,now).ready,false);
  assert.match(membershipView(restoring,refunded,now).title,/恢复中/);
  const expired = await fixture.service.order('order-expired:monthly');
  assert.equal(orderView(expired,now).status,'expired');
});
