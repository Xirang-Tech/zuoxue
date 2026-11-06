import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createCipheriv } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { WechatPayments } from '../server/wechat.mjs';
test('payment notification verifies raw body, platform key serial and timestamp',async t=>{
  const dir=await mkdtemp(`${tmpdir()}/union-wechat-test-`);t.after(()=>rm(dir,{recursive:true,force:true}));
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const keyPath=`${dir}/platform.pem`;await writeFile(keyPath,publicKey.export({type:'spki',format:'pem'}));
  const payment=new WechatPayments({platformSerial:'serial',platformKeyFile:keyPath});
  const raw='{"id":"notification"}',now=Date.now(),timestamp=String(Math.floor(now/1000)),nonce='nonce';
  const signer=createSign('RSA-SHA256');signer.update(`${timestamp}\n${nonce}\n${raw}\n`);
  const headers={'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':'serial','wechatpay-signature':signer.sign(privateKey,'base64')};
  payment.verify(raw,headers,now);
  assert.throws(()=>payment.verify(raw+' ',headers,now));assert.throws(()=>payment.verify(raw,{...headers,'wechatpay-serial':'other'},now));assert.throws(()=>payment.verify(raw,headers,now+301000));
});
test('notification ciphertext authenticates before exposing a successful transaction',()=>{
  const apiKey='12345678901234567890123456789012',nonce='123456789012',aad='transaction';
  const event={appid:'app',mchid:'merchant',trade_state:'SUCCESS',out_trade_no:'uo_example',transaction_id:'wx-example',success_time:'2026-01-31T12:00:00Z',amount:{total:14900,currency:'CNY'}};
  const cipher=createCipheriv('aes-256-gcm',Buffer.from(apiKey),Buffer.from(nonce));cipher.setAAD(Buffer.from(aad));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(event)),cipher.final(),cipher.getAuthTag()]);
  const raw=JSON.stringify({resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data:aad,ciphertext:encrypted.toString('base64')}});
  const payment=new WechatPayments({apiKey,appId:'app',mchId:'merchant'});
  assert.equal(payment.payment(payment.decrypt(raw)).amountCents,14900);
  assert.throws(()=>new WechatPayments({apiKey:'00000000000000000000000000000000'}).decrypt(raw));
  assert.throws(()=>payment.payment({...event,mchid:'attacker'}));
});
