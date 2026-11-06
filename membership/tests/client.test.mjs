import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnionClient } from '../integrations/client.mjs';
test('product integration is hidden when unconfigured or unreachable', async () => {
  assert.equal((await createUnionClient({productId:'aipm'}).offer('central')).visible,false);
  const client = createUnionClient({productId:'aipm',origin:'https://member.zuoxue.com',token:'server-only',fetcher:async () => {throw new Error('offline');}});
  assert.equal((await client.offer('central')).visible,false);
});
test('only server-resolved identity is sent with a product-specific credential', async () => {
  const calls = [];
  const client = createUnionClient({productId:'aipm',origin:'https://member.zuoxue.com',token:'server-secret',fetcher:async (url,init) => {calls.push({url,init}); return Response.json({visible:true,variant:'B'});}});
  assert.equal((await client.offer('trusted-central','pro')).visible,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].init.headers.authorization,'Bearer server-secret');
  assert.equal(JSON.parse(calls[0].init.body).centralUserId,'trusted-central');
});
test('unconfigured telemetry is not acknowledged as delivered', async()=>{
  await assert.rejects(createUnionClient({productId:'aipm'}).receipt('central',{id:'payment-1'}));
});
