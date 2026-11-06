/** Server only. Resolve centralUserId from the authenticated local user, never from browser input. */
export function createUnionClient({ origin, token, productId, fetcher = fetch }) {
  async function call(action, centralUserId, body = {}) {
    if (!origin || !token || !centralUserId) throw new Error('联合会员服务或中心账号尚未配置');
    const url = new URL(origin);
    if (url.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('会员服务必须使用 HTTPS');
    const response = await fetcher(`${origin.replace(/\/$/,'')}/internal/${action}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({centralUserId,...body}),signal:AbortSignal.timeout(4000)});
    if (!response.ok) throw new Error('会员服务暂时不可用');
    return response.json();
  }
  return {
    async offer(centralUserId, baselineStatus = 'unknown') {
      try { return await call('enroll',centralUserId,{baselineStatus}); }
      catch { return {visible:false,purchasable:false}; }
    },
    event(centralUserId,name,context,id,occurredAt) { return call('events',centralUserId,{name,context,id,occurredAt}); },
    receipt(centralUserId,receipt) { return call('receipts',centralUserId,receipt); },
    productId,
  };
}
