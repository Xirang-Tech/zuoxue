import { createDecipheriv, createPrivateKey, createPublicKey, createSign, createVerify, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { insist } from '../shared/domain.mjs';

export class WechatPayments {
  constructor(config, fetcher = fetch) { this.config = config; this.fetcher = fetcher; }
  ready() {
    const c = this.config;
    try { return Boolean(c.appId && c.mchId && c.serial && c.platformSerial && Buffer.byteLength(c.apiKey || '') === 32 && new URL(c.origin).protocol === 'https:' && createPrivateKey(readFileSync(c.privateKeyFile)).asymmetricKeyType === 'rsa' && createPublicKey(readFileSync(c.platformKeyFile)).asymmetricKeyType === 'rsa'); }
    catch { return false; }
  }
  verify(raw, headers, now = Date.now()) {
    const timestamp = String(headers['wechatpay-timestamp'] || '');
    const nonce = headers['wechatpay-nonce'];
    insist(/^\d+$/.test(timestamp) && Math.abs(now / 1000 - Number(timestamp)) < 300 && nonce && headers['wechatpay-serial'] === this.config.platformSerial, 401, 'invalid_signature', '支付签名无效');
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${timestamp}\n${nonce}\n${raw}\n`);
    insist(verifier.verify(readFileSync(this.config.platformKeyFile), String(headers['wechatpay-signature'] || ''), 'base64'), 401, 'invalid_signature', '支付签名无效');
  }
  decrypt(raw) {
    const resource = JSON.parse(raw).resource;
    insist(resource?.algorithm === 'AEAD_AES_256_GCM', 400, 'invalid_notification', '支付通知无效');
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.config.apiKey), Buffer.from(resource.nonce));
    decipher.setAuthTag(encrypted.subarray(-16));
    decipher.setAAD(Buffer.from(resource.associated_data || ''));
    return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString('utf8'));
  }
  async request(method, route, body) {
    insist(this.ready(), 503, 'payment_unconfigured', '支付尚未配置');
    const c = this.config, raw = body === undefined ? '' : JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000)), nonce = randomBytes(16).toString('hex');
    const signer = createSign('RSA-SHA256');
    signer.update(`${method}\n${route}\n${timestamp}\n${nonce}\n${raw}\n`);
    const signature = signer.sign(readFileSync(c.privateKeyFile), 'base64');
    const response = await this.fetcher(`https://api.mch.weixin.qq.com${route}`, { method, headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${c.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${c.serial}",signature="${signature}"` }, body: raw || undefined, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    insist(response.ok, 503, 'payment_unavailable', '支付渠道暂时不可用，请重试原订单');
    if (!text) return {};
    this.verify(text, Object.fromEntries(response.headers));
    return JSON.parse(text);
  }
  async create(order) {
    const response = await this.request('POST', '/v3/pay/transactions/native', { appid: this.config.appId, mchid: this.config.mchId, description: `佐学联合大会员 · ${order.snapshot.plan.name}`, out_trade_no: order.id, time_expire: new Date(Number(order.expires_at)).toISOString(), notify_url: `${this.config.origin}/api/payments/wechat/payment`, amount: { total: order.amount_cents, currency: 'CNY' } });
    insist(typeof response.code_url === 'string' && response.code_url.startsWith('weixin://wxpay/'), 503, 'invalid_checkout', '支付二维码生成失败');
    return response.code_url;
  }
  query(orderId) { return this.request('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${encodeURIComponent(this.config.mchId)}`); }
  close(orderId) { return this.request('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}/close`, { mchid: this.config.mchId }); }
  refund(refund, order) { return this.request('POST', '/v3/refund/domestic/refunds', { out_trade_no: order.id, out_refund_no: refund.id, reason: '人工审核联合会员整单退款', notify_url: `${this.config.origin}/api/payments/wechat/refund`, amount: { refund: order.amount_cents, total: order.amount_cents, currency: 'CNY' } }); }
  queryRefund(refundId) { return this.request('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(refundId)}`); }
  payment(event) {
    insist(event.appid === this.config.appId && event.mchid === this.config.mchId && event.trade_state === 'SUCCESS', 400, 'invalid_payment', '支付主体不匹配');
    return { orderId: event.out_trade_no, transactionId: event.transaction_id, amountCents: event.amount?.total, currency: event.amount?.currency, paidAt: Date.parse(event.success_time) };
  }
}
