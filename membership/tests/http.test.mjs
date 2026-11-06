import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMembershipServer } from '../server/http.mjs';
import { MEDIA_FILES } from '../public/media.js';
async function fixture(t) {
  const calls=[];
  const service={db:{query:async()=>({rows:[]})},problems:()=>['not ready'],enroll:async(...args)=>calls.push(['enroll',...args]),eligibility:async()=>({visible:false}),offers:async()=>({visible:false,catalog:null}),recordEvent:async(...args)=>calls.push(['event',...args]),quote:async()=>{throw Object.assign(new Error('当前暂未开放联合会员购买'),{status:403,code:'sale_unavailable'});}};
  const config={origin:'http://127.0.0.1',production:false,clients:{aipm:{token:'product-token-with-at-least-32-characters'}},identity:{rpKey:'test',publicOrigin:''},experiment:{salesEnabled:false},adminToken:'admin-only'};
  const identity={user:async request=>{if(request.headers.cookie!=='valid=1')throw Object.assign(new Error('请先登录'),{status:401});return 'server-resolved-user';}};
  const server=createMembershipServer({service,identity,config}); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`; config.origin=origin;
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const request=(path,body,headers={})=>fetch(`${origin}${path}`,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json',origin}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {request,origin,calls};
}
test('anonymous users and browser-supplied identities cannot call internal APIs',async t=>{
  const x=await fixture(t); assert.equal((await x.request('/api/me')).status,401);
  assert.equal((await x.request('/internal/enroll',{centralUserId:'forged'})).status,401);
  assert.equal(x.calls.length,0);
});
test('product-to-service credential is mandatory and scopes enrollment to that product',async t=>{
  const x=await fixture(t); const response=await x.request('/internal/enroll',{centralUserId:'trusted',productId:'workflow'},{authorization:'Bearer product-token-with-at-least-32-characters'});
  assert.equal(response.status,200); assert.equal(x.calls[0][2],'aipm');
});
test('control users cannot bypass access with URL parameters and client-side core events are rejected',async t=>{
  const x=await fixture(t),headers={cookie:'valid=1'};
  assert.equal((await x.request('/api/me?variant=B',undefined,headers)).status,200);
  assert.equal((await x.request('/api/quotes',{planId:'monthly',variant:'B'},headers)).status,403);
  assert.equal((await x.request('/api/events',{name:'core_task_completed',productId:'aipm'},headers)).status,403);
});
test('cross-origin state changes and non-allowlisted website entry access are rejected',async t=>{
  const x=await fixture(t);
  assert.equal((await x.request('/api/quotes',{planId:'monthly'},{cookie:'valid=1',origin:'https://evil.example'})).status,403);
  assert.equal((await x.request('/api/website-entry',undefined,{cookie:'valid=1',origin:'https://evil.example'})).status,403);
  const allowed=await x.request('/api/website-entry',undefined,{cookie:'valid=1',origin:'https://zuoxue.com'});
  assert.equal(allowed.headers.get('access-control-allow-origin'),'https://zuoxue.com'); assert.equal((await allowed.json()).visible,false);
});
test('the public website account route starts in account mode and exposes a trusted website origin',async t=>{
  const x=await fixture(t);
  const account=await x.request('/account?return=https://evil.example/');
  assert.equal(account.status,200);
  assert.match(await account.text(), /<html[^>]+data-website-entry>/);
  assert.doesNotMatch(await (await x.request('/')).text(), /<html[^>]+data-website-entry>/);
  assert.equal((await (await x.request('/api/config')).json()).websiteOrigin,'https://zuoxue.com');
  assert.equal((await x.request('/api/me')).status,401);
});
test('the product gallery serves only approved local images and modules without exposing private files',async t=>{
  const x=await fixture(t);
  for(const path of [...new Set(MEDIA_FILES),'/showcase.js','/media.js','/member-view.js']) {
    const response=await x.request(path);
    assert.equal(response.status,200,path);
    assert.match(response.headers.get('content-type'),path.endsWith('.js')?/text\/javascript/:/image\//,path);
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.ok((await response.arrayBuffer()).byteLength>100,path);
  }
  for(const path of ['/media/.env','/media/LUCIDE-LICENSE','/media/%2e%2e/config/catalog.json']) {
    assert.notEqual((await x.request(path)).status,200,path);
  }
});
test('production does not expose preview controls or accept scenario overrides',async t=>{
  const x=await fixture(t),headers={cookie:'valid=1'};
  for(const path of ['/preview-controls.js','/__preview/state']) assert.equal((await x.request(path,undefined,headers)).status,404);
  assert.equal((await x.request('/__preview/scenario',{scenario:'active'},headers)).status,404);
  assert.equal((await (await x.request('/api/config?preview=true')).json()).preview,false);
  const orders=await (await x.request('/api/orders',undefined,headers)).json();
  assert.deepEqual(orders,{pending:null,latest:null});
});
