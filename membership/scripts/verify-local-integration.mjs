import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { LOCAL_TEST_USERS, LOCAL_TEST_PASSWORD } from '../integrations/local-identity-fixture.mjs';
const base=fileURLToPath(new URL('../output/local-integration/',import.meta.url));
const {obfuscatePassword}=await import(new URL('../output/local-integration/sources/workflow/shared/passwordWire.mjs',import.meta.url));
const {wrapPassword}=await import(new URL('../output/local-integration/sources/pattern/server/passwordWrap.js',import.meta.url));
const report=[];
async function request(origin,path,body,headers={}) {return fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000)});}
const targets=[['keban',5101],['aipm',5102],['workflow',5103],['pattern',5104]];
for(const [product,port] of targets) {
 const origin=`http://127.0.0.1:${port}`;
 for(const [index,user] of LOCAL_TEST_USERS.entries()) {
  const password=product==='workflow'?obfuscatePassword(LOCAL_TEST_PASSWORD):product==='pattern'?wrapPassword(LOCAL_TEST_PASSWORD):LOCAL_TEST_PASSWORD;
  const login=await request(origin,'/api/auth/login',{identifier:user.email,password});
  const data=await login.json();assert.equal(login.status,200,`${product} ${index?'B':'A'} login: ${JSON.stringify(data.error||{})}`);
  const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const accessToken=data.accessToken || data.token || data.session?.accessToken;
  const headers={...(cookie?{cookie}:{}),...(accessToken?{authorization:`Bearer ${accessToken}`}:{})};
  const offerResponse=await request(origin,'/api/union-membership?variant=B',undefined,headers);
  const offer=await offerResponse.json();assert.equal(offerResponse.status,200,`${product} offer`);
  assert.equal(offer.visible,index===1,`${product} cohort visibility`);assert.equal(offer.purchasable,false);
  assert.equal(offer.centerUrl,'http://127.0.0.1:5105');
  if(index===1){assert.equal(offer.displayPricing.prices.monthly,9900);assert.equal(offer.catalog.plans[0].priceCents,null);}
  const event=await request(origin,'/api/union-membership/events',{name:'union_clicked',context:{entry:'paywall'},entry:'paywall'},headers);
  assert.equal(event.status,200,`${product} event: ${await event.text()}`);
  if(product==='keban')assert.equal((await request(origin,'/api/union-membership/events',{name:'union_clicked'}, {...headers,origin:'https://untrusted.example'})).status,403,'keban rejects a forged browser origin');
  for(const path of ['/api/billing/checkout','/api/billing/orders','/api/ai/text','/internal/union-membership/activate'])assert.equal((await request(origin,path,{},headers)).status,403,`${product} ${path}`);
  report.push({product,group:index?'B':'A',login:'passed',visible:offer.visible,demoPrice:index?9900:null,event:'passed',financialAndAiRequests:'blocked'});
 }
}
for(const[index,user]of LOCAL_TEST_USERS.entries()){
 const origin='http://127.0.0.1:5105';const login=await request(origin,'/api/auth/login',{identifier:user.email,password:LOCAL_TEST_PASSWORD});assert.equal(login.status,200);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 const me=await(await request(origin,'/api/me?variant=B',undefined,{cookie})).json();assert.equal(me.visible,index===1);assert.equal(me.purchasable,false);
 for(const path of ['/api/quotes','/api/orders','/api/payments/wechat/payment'])assert.equal((await request(origin,path,{planId:'monthly'},{cookie})).status,403);
}
const db=new pg.Pool({connectionString:'postgres://union_local@127.0.0.1:56473/zuoxue_union_local',max:1});
try{
 const assignments=(await db.query('SELECT central_user_id,variant,is_test FROM union_assignments ORDER BY central_user_id')).rows;
 assert.equal(assignments.length,2);assert(assignments.every(row=>row.is_test));
 assert.equal(Number((await db.query('SELECT count(*) FROM union_orders')).rows[0].count),0);
 assert.equal(Number((await db.query('SELECT count(*) FROM union_tasks')).rows[0].count),0);
 assert.equal(Number((await db.query('SELECT count(*) FROM union_events WHERE NOT is_test')).rows[0].count),0);
 report.push({centralAssignments:assignments.map(row=>({group:row.variant,isTest:row.is_test})),realOrders:0,entitlementTasks:0,nonTestEvents:0});
}finally{await db.end();}
await writeFile(join(base,'api-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
