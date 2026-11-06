import { test,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../../server/database.mjs';
import { createProductAdapter,PRODUCT_ADAPTER_SCHEMA } from '../../integrations/product-adapter.mjs';
import { OUTBOX_SCHEMA,enqueueUnionTelemetry,flushUnionTelemetry } from '../../integrations/outbox.mjs';
const connection=process.env.TEST_DATABASE_URL;
if(connection&&!['127.0.0.1','localhost'].includes(new URL(connection).hostname))throw new Error('测试仅允许本机数据库');
const root=connection?new Database(connection):null;
after(async()=>root?.close());
async function setup(t){
  const schema=`union_adapter_test_${randomUUID().replaceAll('-','')}`;await root.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(connection);url.searchParams.set('options',`-c search_path=${schema}`);const db=new Database(url.href);
  t.after(async()=>{await db.close();await root.query(`DROP SCHEMA ${schema} CASCADE`);});
  await db.query(PRODUCT_ADAPTER_SCHEMA);await db.query(OUTBOX_SCHEMA);
  await db.query('CREATE TABLE native_account(id text PRIMARY KEY,tier text,credits integer,extra integer,expires_at bigint)');
  let now=1000000;await db.query("INSERT INTO native_account VALUES('central','max',123,50,$1)",[now+20*86400000]);
  const hooks={
    read:async tx=>{const account=(await tx.query("SELECT * FROM native_account WHERE id='central' FOR UPDATE")).rows[0];return {ready:true,tierRank:2,autoRenewActive:false,pendingReservations:0,pendingSubscriptionOrder:false,frozen:{...account,pausedAt:now}};},
    pause:async tx=>{await tx.query("UPDATE native_account SET credits=0 WHERE id='central'");},
    install:async(tx,_current,body)=>{await tx.query("UPDATE native_account SET tier=$1,expires_at=$2 WHERE id='central'",[body.contract.effectiveTierId,body.expiresAt]);},
    grant:async(tx,_record,body)=>{await tx.query("UPDATE native_account SET credits=credits+$1 WHERE id='central'",[body.amount]);},
    extend:async(tx,_record,body)=>{await tx.query("UPDATE native_account SET expires_at=$1 WHERE id='central'",[body.expiresAt]);},
    revoke:async tx=>{await tx.query("UPDATE native_account SET credits=0 WHERE id='central'");},
    restore:async(tx,record)=>{await tx.query("UPDATE native_account SET tier=$1,credits=$2,expires_at=$3 WHERE id='central'",[record.frozen.tier,record.frozen.credits,now+Number(record.frozen.expires_at)-record.frozen.pausedAt]);},
  };
  const adapter=createProductAdapter({db,token:'only-server',verified:true,hooks,now:()=>now});
  const base={planId:'monthly',centralUserId:'central',membershipId:'membership',revision:1,startsAt:now,expiresAt:now+30*86400000,contract:{effectiveTierId:'max',effectiveTierRank:2,grants:{monthly:[{unit:'credits',amount:2800}],yearly:[{unit:'credits',amount:2800}]}}};
  const call=(action,payload)=>adapter.handle(action,{...base,...payload},'only-server');
  return {db,hooks,adapter,base,call,advance:ms=>now+=ms};
}
const dbTest=(name,fn)=>test(name,{skip:!connection},fn);
dbTest('product adapter applies repeated operations once and restores old quota without restoring spent top-ups',async t=>{
  const x=await setup(t);await x.call('activate',{operationId:'activate'});
  await Promise.all([x.call('grant',{operationId:'grant',amount:2800,unit:'credits'}),x.call('grant',{operationId:'grant',amount:2800,unit:'credits'})]);
  assert.equal((await x.db.query('SELECT credits FROM native_account')).rows[0].credits,2800);
  await x.db.query('UPDATE native_account SET credits=2700,extra=40');x.advance(30*86400000);
  await x.call('restore',{operationId:'restore'});await x.call('restore',{operationId:'restore'});
  const account=(await x.db.query('SELECT * FROM native_account')).rows[0];assert.equal(account.credits,123);assert.equal(account.extra,40);assert.equal(account.tier,'max');
});
dbTest('partial business mutations roll back together with the freeze snapshot',async t=>{
  const x=await setup(t);x.hooks.install=async()=>{throw new Error('native install failed');};
  await assert.rejects(x.call('activate',{operationId:'activate'}));
  assert.equal((await x.db.query('SELECT credits FROM native_account')).rows[0].credits,123);
  assert.equal((await x.db.query('SELECT * FROM union_product_contracts')).rowCount,0);
});
dbTest('same operation id cannot be reused for a different allowance and expired grants are rejected',async t=>{
  const x=await setup(t);await x.call('activate',{operationId:'activate'});await x.call('grant',{operationId:'grant',amount:10,unit:'credits'});
  await assert.rejects(x.call('grant',{operationId:'grant',amount:20,unit:'credits'}),{code:'operation_conflict'});
  x.advance(40*86400000);await assert.rejects(x.call('grant',{operationId:'late',amount:10,unit:'credits'}),{code:'grant_outside_validity'});
});
dbTest('unverified hooks and invalid product credentials cannot activate an entitlement',async t=>{
  const x=await setup(t);const unverified=createProductAdapter({db:x.db,token:'token',hooks:x.hooks,verified:false});
  assert.equal((await unverified.execute('snapshot',{centralUserId:'central'})).ready,false);
  await assert.rejects(x.adapter.handle('activate',x.base,'wrong'),{status:401});
});
dbTest('durable telemetry retries with the original id and never drops an unacknowledged payment',async t=>{
  const x=await setup(t);await x.db.transaction(tx=>enqueueUnionTelemetry(tx,{id:'payment-1',centralUserId:'central',kind:'receipt',payload:{orderId:'native-order',kind:'payment',amountCents:6900,occurredAt:1000}}));
  await flushUnionTelemetry(x.db,{receipt:async()=>{throw new Error('offline');}});assert.equal((await x.db.query('SELECT sent_at FROM union_telemetry_outbox')).rows[0].sent_at,null);
  const seen=[];await flushUnionTelemetry(x.db,{receipt:async(_id,body)=>seen.push(body)});await flushUnionTelemetry(x.db,{receipt:async(_id,body)=>seen.push(body)});
  assert.equal(seen.length,1);assert.equal(seen[0].id,'payment-1');
});

dbTest('a monthly grant cannot use a yearly-only allowance',async t=>{
 const x=await setup(t);x.base.contract.grants.yearly=[{unit:'credits',amount:5000}];
 await x.call('activate',{operationId:'activate'});
 await assert.rejects(x.call('grant',{operationId:'wrong-plan',amount:5000,unit:'credits'}),{code:'grant_exceeds_contract'});
});
