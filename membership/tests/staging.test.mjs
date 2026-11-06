import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadConfig } from '../server/config.mjs';
import { MembershipService } from '../server/service.mjs';
import { createMembershipServer } from '../server/http.mjs';
import { safeReturnUrl, STAGING_PRODUCT_ORIGINS } from '../shared/domain.mjs';

const catalog = JSON.parse(await readFile(new URL('../config/catalog.json',import.meta.url),'utf8'));
function env(extra={}) { return { NODE_ENV:'production',DEPLOYMENT_ENV:'staging',PUBLIC_ORIGIN:'https://dev-member.zuoxue.com',DATABASE_URL:'postgres://localhost/zuoxue_membership_dev',IDENTITY_SERVICE_URL:'https://dev-auth.zuoxue.com',IDENTITY_PUBLIC_ORIGIN:'https://dev-auth.zuoxue.com',EXPERIMENT_SALT:'x'.repeat(32),ADMIN_TOKEN:'y'.repeat(32),STAGING_TEST_ACCOUNTS_JSON:JSON.stringify({'account-a':'A','account-b':'B'}),...extra }; }
async function fixture() {
  const config=await loadConfig(env());
  const assignments=new Map(),events=[],calls=[];
  const db={query:async(sql,values=[])=>{
    if(sql.startsWith('INSERT INTO union_assignments')) {if(!assignments.has(values[0]))assignments.set(values[0],{central_user_id:values[0],experiment_version:values[1],variant:values[2],first_product:values[3],is_test:values[5],enrolled_at:values[6]});return {rows:[]};}
    if(sql.includes('FROM union_assignments'))return {rows:assignments.has(values[0])?[assignments.get(values[0])]:[]};
    if(sql.startsWith('INSERT INTO union_events'))events.push(values);
    return {rows:[]};
  }};
  const external=new Proxy({}, {get:(_target,key)=>()=>{calls.push(key);throw new Error('external access forbidden');}});
  const service=new MembershipService({db,catalog,adapters:external,payments:external,config:config.experiment});
  return {config,service,assignments,events,calls};
}
test('staging requires dedicated origin, identity and database, and production rejects test overrides',async()=>{
  const config=await loadConfig(env({PRODUCT_CLIENTS_JSON:JSON.stringify({keban:{token:'a'.repeat(32)}})}));
  assert.equal(config.clients.keban.isTest,true);
  assert.equal(config.experiment.salesEnabled,false);
  assert.deepEqual(config.productOrigins,STAGING_PRODUCT_ORIGINS);
  for(const extra of [{PUBLIC_ORIGIN:'https://member.zuoxue.com'},{IDENTITY_PUBLIC_ORIGIN:'https://auth.zuoxue.com'},{IDENTITY_SERVICE_URL:'https://auth.zuoxue.com'},{DATABASE_URL:'postgres://localhost/zuoxue_membership'},{EXPERIMENT_VERSION:'union-v1'},{SALES_ENABLED:'true'},{WECHAT_MCH_ID:'accidental-live-key'},{DEPLOYMENT_ENV:'production'},{NODE_ENV:'development'}])await assert.rejects(loadConfig(env(extra)),{code:'config_invalid'});
});
test('only allowlisted staging accounts enroll, groups stay fixed and events remain test data',async()=>{
  const x=await fixture();
  assert.equal(await x.service.enroll('unknown','keban'),null);
  assert.equal(x.assignments.size,0);
  await x.service.enroll('account-b','keban');
  for(const product of ['aipm','workflow','pattern'])await x.service.enroll('account-b',product,{isTest:false});
  assert.equal(x.assignments.get('account-b').variant,'B');assert.equal(x.assignments.get('account-b').first_product,'keban');assert.equal(x.assignments.get('account-b').is_test,true);
  x.config.experiment.testGroups['account-b']='A';
  await x.service.enroll('account-b','pattern');assert.equal(x.assignments.get('account-b').variant,'B');
  await x.service.recordEvent('account-b','keban','union_clicked',{entry:'paywall'});
  assert.equal(x.events[0].at(-1),true);
});
test('staging B sees display prices without modifying order prices, A and unlisted accounts stay hidden',async()=>{
  const x=await fixture();
  const b=await x.service.offers('account-b');assert.equal(b.visible,true);assert.equal(b.purchasable,false);assert.deepEqual(b.displayPricing.prices,{monthly:9900,yearly:79900});
  assert.deepEqual(b.catalog.plans.map(p=>p.priceCents),[null,null]);
  for(const user of ['account-a','unknown','__proto__']) {const offer=await x.service.offers(user);assert.equal(offer.visible,false);assert.equal(offer.catalog,null);assert.equal(offer.displayPricing,undefined);}
  assert.equal(x.calls.length,0);
});
test('website events preserve attribution without enrolling or counting the website as a product',async()=>{
  const x=await fixture();
  await x.service.recordEvent('account-b','website','center_viewed',{entry:'website'});
  assert.equal(x.assignments.size,0);
  assert.equal(x.events.length,0);
  await x.service.enroll('account-b','aipm');
  await x.service.recordEvent('account-b','website','plan_selected',{entry:'website',planId:'yearly'});
  assert.equal(x.assignments.get('account-b').first_product,'aipm');
  assert.equal(x.events[0][4],'website');
  assert.deepEqual(x.events[0][6],{entry:'website',planId:'yearly'});
  assert.equal(x.events[0].at(-1),true);
  await assert.rejects(x.service.recordEvent('account-b','website','core_task_completed',{entry:'website'}),{code:'invalid_event'});
  await assert.rejects(x.service.enroll('account-b','website'),{code:'invalid_product'});
});
test('staging transactions and background workers never call products or payment providers',async()=>{
  const x=await fixture();x.service.config.salesEnabled=true;
  for(const action of [()=>x.service.quote('account-b','monthly'),()=>x.service.createOrder('account-b','quote','attempt-key-123'),()=>x.service.checkout('account-b','order'),()=>x.service.acceptPayment({}),()=>x.service.prepareRefund('order','operator'),()=>x.service.acceptRefund({}),()=>x.service.enqueue({},'task')])await assert.rejects(action(),{code:'staging_transactions_disabled'});
  await x.service.runWorker();await x.service.reconcilePayments();await x.service.reconcileRefunds();await x.service.scheduleRestoration();
  assert.equal(await x.service.status('account-b'),null);assert.equal(x.calls.length,0);
});
test('return locations remain in the matching test product including hash routes',()=>{
  const origins=STAGING_PRODUCT_ORIGINS,center='https://dev-member.zuoxue.com';
  const task='https://dev-workbench.zuoxue.com/#project/demo';
  assert.equal(safeReturnUrl(task,'aipm',origins,center),task);
  for(const unsafe of ['https://workbench.zuoxue.com/#project/demo','https://dev-pattern.zuoxue.com/flow','https://evil.example/','https://dev-workbench.zuoxue.com/?token=secret'])assert.equal(safeReturnUrl(unsafe,'aipm',origins,center),origins.aipm);
  assert.equal(safeReturnUrl('https://aiprd.zuoxue.com/','aiprd',origins,center),center);
});
test('staging HTTP exposes trusted addresses and CSP while refusing payment callbacks and local preview controls',async t=>{
  const x=await fixture();let user='account-b';
  const server=createMembershipServer({service:x.service,identity:{user:async()=>user},config:x.config});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const request=(path,body)=>fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin:x.config.origin,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const config=await request('/api/config');assert.match(config.headers.get('content-security-policy'),/connect-src 'self' https:\/\/dev-auth\.zuoxue\.com;/);assert.doesNotMatch(config.headers.get('content-security-policy'),/ https:\/\/auth\.zuoxue/);
  const data=await config.json();assert.equal(data.environment,'staging');assert.equal(data.preview,false);assert.deepEqual(data.productOrigins,STAGING_PRODUCT_ORIGINS);assert.equal(data.testGroups,undefined);
  for(const path of ['/api/quotes','/api/orders','/api/payments/wechat/payment','/api/payments/wechat/refund'])assert.equal((await request(path,{})).status,403,path);
  assert.equal((await request('/__preview/state')).status,404);assert.equal((await request('/preview-controls.js')).status,404);
  user='account-a';const a=await(await request('/api/me?variant=B&preview=true')).json();assert.equal(a.visible,false);assert.equal(a.purchasable,false);
});
