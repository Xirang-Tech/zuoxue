import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMembershipServer } from '../server/http.mjs';
import { createPreviewFixture, SCENARIOS } from '../server/preview-fixture.mjs';
const catalog = JSON.parse(await readFile(new URL('../config/catalog.json',import.meta.url),'utf8'));
const preview = JSON.parse(await readFile(new URL('../config/preview.json',import.meta.url),'utf8'));
test('preview scenarios are isolated by cookie, origin checked, and cannot create payable orders or QR codes', async t => {
  const fixture = createPreviewFixture(catalog,preview);
  const config = { preview:true,origin:'http://127.0.0.1',production:false,clients:{},identity:{rpKey:'preview',publicOrigin:''},experiment:{salesEnabled:false} };
  const server = createMembershipServer({service:fixture.service,identity:fixture.identity,config,previewHandler:fixture.handle});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  let cookie = '';
  async function request(path,body,headers={}) {
    const response = await fetch(config.origin+path,{method:body === undefined ? 'GET' : 'POST',headers:{origin:config.origin,cookie,'content-type':'application/json',...headers},body:body === undefined ? undefined : JSON.stringify(body)});
    if(response.headers.get('set-cookie')) cookie=response.headers.get('set-cookie').split(';')[0];
    return response;
  }
  assert.equal((await request('/__preview/scenario',{scenario:'active'},{origin:'https://evil.example'})).status,403);
  assert.equal((await request('/__preview/scenario',{scenario:'unknown'})).status,400);
  for (const [scenario] of SCENARIOS) {
    assert.equal((await request('/__preview/scenario',{scenario,planId:'yearly'})).status,200,scenario);
    const info=await (await request('/__preview/state')).json(); assert.equal(info.scenario,scenario); assert.equal(info.planId,'yearly');
    const me=await request('/api/me'); assert.equal(me.status,scenario === 'anonymous' ? 401 : 200,scenario);
  }
  await request('/__preview/scenario',{scenario:'pending'});
  const orders=await (await request('/api/orders')).json(); assert.equal(orders.pending.status,'pending'); assert.equal(orders.latest.id,orders.pending.id);
  assert.equal((await request(`/api/orders/${orders.pending.id}/qr`)).status,403);
  assert.equal((await request('/api/orders',{quoteId:'demo-quote'},{'idempotency-key':'demo-only-attempt'})).status,403);
  await request('/__preview/action',{action:'pay'});
  const member=(await (await request('/api/membership')).json()).membership; assert.equal(member.status,'activating');
  assert.equal((await (await fetch(config.origin+'/__preview/state')).json()).scenario,'unpaid');
});
