import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addMonths, assignVariant, catalogProblems, effectiveContract, grantSchedule, safeReturnUrl, sameSecret } from '../shared/domain.mjs';
test('month-end anniversaries retain their original anchor and time', () => {
  const start = Date.parse('2024-01-31T12:30:00Z');
  assert.equal(new Date(addMonths(start,1)).toISOString(),'2024-02-29T12:30:00.000Z');
  assert.equal(new Date(addMonths(start,2)).toISOString(),'2024-03-31T12:30:00.000Z');
  assert.equal(new Date(addMonths(Date.parse('2024-02-29T12:30:00Z'),12)).toISOString(),'2025-02-28T12:30:00.000Z');
});
test('one central identity always receives the same assignment across products', () => {
  const groups = Array.from({length:1000},(_,i) => assignVariant(`central-${i}`,'v1','salt'));
  assert(groups.filter(group => group === 'A').length > 400 && groups.filter(group => group === 'A').length < 600);
  assert.equal(assignVariant('user','v1','salt'),assignVariant('user','v1','salt'));
  assert.throws(() => assignVariant('user','v1',''));
});
test('calendar anniversaries follow Shanghai dates when UTC is still the previous day', () => {
  const start=Date.parse('2026-04-30T18:00:00Z'); // May 1, 02:00 in Shanghai.
  assert.equal(new Date(addMonths(start,1)).toISOString(),'2026-05-31T18:00:00.000Z');
});
test('shipped catalog cannot enable a purchase without approvals, prices and grants', async () => {
  const catalog = JSON.parse(await readFile(new URL('../config/catalog.json',import.meta.url),'utf8'));
  const problems = catalogProblems(catalog);
  assert(problems.includes('成本核算未通过'));
  assert(problems.some(value => value.includes('价格')));
  assert(problems.some(value => value.includes('权益未核验')));
});
test('return locations reject other products, embedded credentials and sensitive query parameters', () => {
  assert.equal(safeReturnUrl('https://evil.example/','aipm'),'https://workbench.zuoxue.com');
  assert.equal(safeReturnUrl('https://workbench.zuoxue.com/?token=secret','aipm'),'https://workbench.zuoxue.com');
  assert.equal(safeReturnUrl('https://workbench.zuoxue.com/#project/abc','aipm'),'https://workbench.zuoxue.com/#project/abc');
  assert.equal(safeReturnUrl('https://name:password@workbench.zuoxue.com/','aipm'),'https://workbench.zuoxue.com');
});
test('higher-tier benefit is inherited only by the product with a verified active entitlement', () => {
  const product = {id:'aipm',name:'AI PM',tierId:'pro',tierName:'专业版',tierRank:1,grants:{monthly:[{unit:'credit',amount:800,schedule:'monthly'}],yearly:[]}};
  const current = {ready:true,autoRenewActive:false,pendingSubscriptionOrder:false,pendingReservations:0,tierId:'max',tierName:'旗舰版',tierRank:2,remainingMs:20*86400000,remainingQuota:{credit:123},highTierVerified:true,highTierGrants:{monthly:[{unit:'credit',amount:2800,schedule:'monthly'}],yearly:[]}};
  const result = effectiveContract(product,current);
  assert.equal(result.effectiveTierId,'max'); assert.equal(result.previous.remainingQuota.credit,123);
  assert.equal(effectiveContract(product,{...current,remainingMs:0}).effectiveTierId,'pro');
  assert.throws(() => effectiveContract(product,{...current,autoRenewActive:true}),/自动续费/);
  assert.throws(() => effectiveContract(product,{...current,pendingReservations:1}),/结算/);
  assert.throws(() => effectiveContract(product,{...current,highTierVerified:false}),/审核/);
});
test('yearly monthly quota is granted in 12 installments while upfront quota is granted once', () => {
  const start = Date.parse('2024-01-31T12:00:00Z'), end = addMonths(start,12);
  const grants = grantSchedule({grants:{yearly:[{unit:'credits',amount:800,schedule:'monthly'},{unit:'transcription_seconds',amount:1440000,schedule:'upfront'}]}},'yearly',start,end);
  assert.equal(grants.length,13); assert.equal(grants.filter(grant => grant.at === start).length,2);
  assert.equal(grants.filter(grant => grant.unit === 'credits').at(-1).expiresAt,end);
});
test('secret comparison fails closed for missing values', () => {
  assert.equal(sameSecret('', ''),false); assert.equal(sameSecret('abc','abc'),true); assert.equal(sameSecret('abc','abcd'),false);
});
test('accumulating project packs persist to membership expiry; tools reset each period', () => {
  const start=Date.parse('2026-01-31T04:00:00Z'), end=addMonths(start,12);
  const grants=grantSchedule({grants:{yearly:[{unit:'projects',amount:3,schedule:'monthly',validity:'membership'},{unit:'tools',amount:30,schedule:'monthly'}]}},'yearly',start,end);
  assert.equal(grants.length,24);
  assert.equal(grants[0].expiresAt,end);
  assert.equal(grants[12].expiresAt,addMonths(start,1));
});
