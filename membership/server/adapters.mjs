import { PRODUCT_IDS, insist } from '../shared/domain.mjs';

export class ProductAdapters {
  constructor(config = {}) { this.config = config; }
  configured() { return PRODUCT_IDS.every(id => this.config[id]?.url && this.config[id]?.token); }
  async call(productId, action, body) {
    const config = this.config[productId];
    insist(config?.url && config?.token, 503, 'adapter_unconfigured', '产品权益接口尚未配置');
    const url = new URL(config.url);
    insist(url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost'].includes(url.hostname)), 503, 'adapter_insecure', '产品权益接口必须使用 HTTPS');
    const response = await fetch(`${config.url.replace(/\/$/, '')}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    insist(response.ok, 503, 'adapter_unavailable', '产品权益服务暂时不可用');
    return response.json();
  }
  async snapshots(centralUserId, { partial = false } = {}) {
    const results = await Promise.all(PRODUCT_IDS.map(async id => {
      try { return [id, await this.call(id, 'snapshot', { centralUserId })]; }
      catch (error) { if (!partial) throw error; return [id, { ready: false, reason: 'balance_unavailable' }]; }
    }));
    return Object.fromEntries(results);
  }
}
