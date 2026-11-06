import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.mjs';
import { localEntryAllowed } from '../integrations/local-entry-proxy.mjs';
import { createLocalIdentityFixture, LOCAL_TEST_PASSWORD, LOCAL_TEST_USERS } from '../integrations/local-identity-fixture.mjs';
import { LOCAL_PRODUCT_ORIGINS, safeReturnUrl } from '../shared/domain.mjs';

const env=(extra={})=>({NODE_ENV:'development',DEPLOYMENT_ENV:'integration',LOCAL_INTEGRATION:'1',PUBLIC_ORIGIN:'http://127.0.0.1:5105',DATABASE_URL:'postgres://union_local@127.0.0.1:56473/zuoxue_union_local',IDENTITY_SERVICE_URL:'http://127.0.0.1:5106',IDENTITY_PUBLIC_ORIGIN:'http://127.0.0.1:5106',...extra});
test('local integration refuses production, remote resources and payment credentials',async()=>{
 const config=await loadConfig(env());
 assert.deepEqual(config.productOrigins,LOCAL_PRODUCT_ORIGINS);
 assert.equal(config.experiment.salesEnabled,false);
 assert.equal(config.experiment.version,'union-local-v1');
 for(const extra of [{NODE_ENV:'production'},{LOCAL_INTEGRATION:'0'},{HOST:'0.0.0.0'},{PUBLIC_ORIGIN:'https://member.zuoxue.com'},{IDENTITY_SERVICE_URL:'https://auth.zuoxue.com'},{DATABASE_URL:'postgres://user@remote.example:56473/zuoxue_union_local'},{DATABASE_URL:'postgres://union_local@127.0.0.1:5432/zuoxue_union_local'},{DATABASE_URL:'not a database URL'},{SALES_ENABLED:'true'},{WECHAT_API_V3_KEY:'accidental-key'},{EXPERIMENT_VERSION:'union-v1'}])await assert.rejects(loadConfig(env(extra)),{code:'config_invalid'});
});
test('local proxy permits login and task saving, while blocking payments and generation',()=>{
 for(const [method,path] of [['POST','/api/auth/login'],['POST','/api/auth/logout'],['GET','/api/billing/orders'],['POST','/api/union-membership/events'],['PUT','/api/data'],['POST','/api/projects'],['PUT','/api/projects/00000000-0000-4000-8000-00000000000b']])assert.equal(localEntryAllowed(method,path),true,path);
 for(const [method,path] of [['POST','/api/billing/orders'],['GET','/api/commerce/orders/o1'],['POST','/api/billing/checkout'],['POST','/api/commerce/test-pay'],['POST','/api/ai/text'],['POST','/api/chat'],['POST','/api/fit'],['POST','/api/billing/webhooks/wechat'],['POST','/internal/union-membership/activate'],['PUT','/api/admin/settings']])assert.equal(localEntryAllowed(method,path),false,path);
});
test('local identity accepts only synthetic accounts with an internal credential',async t=>{
 const token='fixture-internal-token';const server=createLocalIdentityFixture(token);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const login=(identifier,password,credential=token)=>fetch(origin+'/internal/auth/login',{method:'POST',headers:{'content-type':'application/json','x-internal-token':credential},body:JSON.stringify({identifier,password})});
 assert.equal((await login(LOCAL_TEST_USERS[0].email,LOCAL_TEST_PASSWORD,'wrong')).status,401);
 assert.equal((await login('real-user@example.com',LOCAL_TEST_PASSWORD)).status,401);
 assert.equal((await login(LOCAL_TEST_USERS[0].email,'wrong')).status,401);
 for(const user of LOCAL_TEST_USERS){const response=await login(user.email,LOCAL_TEST_PASSWORD);assert.equal(response.status,200);const data=await response.json();assert.equal(data.centralUserId,user.centralUserId);assert.equal(data.sessionEpoch,0);assert.equal(data.establishCode,undefined);}
});
test('local task return stays on the source product and retains hash routes',()=>{
 const task='http://127.0.0.1:5102/#project/local-project:local-work';
 assert.equal(safeReturnUrl(task,'aipm',LOCAL_PRODUCT_ORIGINS),task);
 for(const unsafe of ['https://workbench.zuoxue.com/#project/demo','http://127.0.0.1:5104/flow','http://127.0.0.1:5112/#project/demo','http://127.0.0.1:5102/?token=secret'])assert.equal(safeReturnUrl(unsafe,'aipm',LOCAL_PRODUCT_ORIGINS),LOCAL_PRODUCT_ORIGINS.aipm);
});
