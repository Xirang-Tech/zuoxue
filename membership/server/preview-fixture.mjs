import { addMonths } from '../shared/domain.mjs';

export const SCENARIOS = Object.freeze([
  ['anonymous', '未登录'], ['unpaid', '未购买'], ['unpriced', '未定价'], ['control', '对照组 A'],
  ['pending', '待支付'], ['closed', '订单关闭'], ['order-expired', '订单过期'],
  ['activating', '支付成功 · 开通中'], ['partial', '部分开通异常'], ['active', '全部开通'],
  ['expired', '联合会员到期'], ['restoring', '原会员恢复中'], ['restored', '原会员恢复完成'],
  ['refunding', '退款处理中'], ['refunded', '退款完成 · 恢复中'], ['refund-restored', '退款与恢复均完成'],
]);
const validScenarios = new Set(SCENARIOS.map(([id]) => id));
const problem = (message, status = 409) => Object.assign(new Error(message), { status });

export function createPreviewFixture(catalog, preview, now = Date.now) {
  function session(request) {
    const raw = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('zuoxue_member_demo='))?.slice(19) || '';
    const [scenario, plan] = raw.split('.');
    return { scenario: validScenarios.has(scenario) ? scenario : preview.defaultScenario, planId: plan === 'yearly' ? 'yearly' : 'monthly' };
  }
  const parse = userId => { const [scenario, planId] = userId.split(':'); return { scenario, planId }; };
  const cookie = (scenario, planId) => `zuoxue_member_demo=${scenario}.${planId}; HttpOnly; SameSite=Strict; Path=/`;
  function demoCatalog(scenario) {
    const demo = structuredClone(catalog);
    for (const plan of demo.plans) plan.priceCents = scenario === 'unpriced' ? null : preview.prices[plan.id];
    return demo;
  }
  function contracts(planId) {
    return demoCatalog('unpaid').products.map(product => ({
      ...product, effectiveTierName: product.id === 'aipm' ? '旗舰版' : product.tierName,
      effectiveTierId: product.id === 'aipm' ? 'max' : product.tierId,
      grants: product.id === 'aipm' ? { monthly: [{ unit: 'credits', amount: 2800, schedule: 'monthly' }], yearly: [{ unit: 'credits', amount: 2800, schedule: 'monthly' }] } : product.grants,
      previous: { tierName: product.id === 'aipm' ? '旗舰版' : '免费版', remainingMs: product.id === 'aipm' ? 20 * 86400000 : 0, remainingQuota: product.id === 'aipm' ? { monthly: 1337, extra: 350 } : {} },
    }));
  }
  function order(userId) {
    const { scenario, planId } = parse(userId);
    const status = { pending: 'pending', closed: 'closed', 'order-expired': 'pending', activating: 'paid', partial: 'paid', active: 'paid', expired: 'paid', restoring: 'paid', restored: 'paid', refunding: 'refunding', refunded: 'refunded', 'refund-restored': 'refunded' }[scenario];
    if (!status) return null;
    return { id: 'uo_0000000000000000000000000001', status, amount_cents: preview.prices[planId], created_at: now() - 120000, expires_at: now() + (scenario === 'order-expired' ? -60000 : 780000), snapshot: { plan: demoCatalog('unpaid').plans.find(plan => plan.id === planId), contracts: contracts(planId) } };
  }
  const service = {
    problems: () => ['本地演示，真实售卖关闭'],
    db: { query: async (sql, values) => {
      if (!sql.includes('FROM union_orders')) return { rows: [] };
      const item = order(values?.[0] || 'unpaid:monthly');
      return { rows: item && (!sql.includes("status='pending'") || item.status === 'pending') ? [item] : [] };
    } },
    offers: async userId => {
      const { scenario } = parse(userId);
      return { visible: scenario !== 'control', purchasable: !['control', 'unpriced', 'refunding'].includes(scenario), variant: scenario === 'control' ? 'A' : 'B', catalog: scenario === 'control' ? null : demoCatalog(scenario) };
    },
    status: async userId => {
      const { scenario, planId } = parse(userId);
      if (!['activating', 'partial', 'active', 'expired', 'restoring', 'restored', 'refunding', 'refunded', 'refund-restored'].includes(scenario)) return null;
      const ended = ['expired', 'restoring', 'restored', 'refunded', 'refund-restored'].includes(scenario);
      const status = ['restoring', 'refunded'].includes(scenario) ? 'restoring' : ['restored', 'refund-restored'].includes(scenario) ? 'expired' : ['activating', 'partial'].includes(scenario) ? 'activating' : 'active';
      const startsAt = addMonths(now(), 0) - 3 * 86400000;
      return { id: 'demo-membership', status, startsAt, expiresAt: ended ? now() - 3600000 : addMonths(startsAt, planId === 'yearly' ? 12 : 1), products: contracts(planId).map((product, index) => {
        const pending = scenario === 'activating' ? index >= 2 : scenario === 'partial' ? index === 3 : status === 'restoring' ? index >= 3 : false;
        return { id: product.id, name: product.name, tierName: status === 'expired' ? product.previous.tierName : product.effectiveTierName, url: product.url, previous: product.previous,
          remainingQuota: scenario === 'active' && index === 4 ? null : ended ? product.previous.remainingQuota : { keban: { transcription_seconds: 64800 }, aiprd: null, aipm: { monthly: 2340, extra: 350 }, workflow: { credits: 220 }, pattern: { projects: 2, tools: 18 } }[product.id],
          operations: [{ action: ended ? 'restore' : 'activate', status: pending ? 'pending' : 'done', attempts: scenario === 'partial' && pending ? 3 : 0 }] };
      }) };
    },
    quote: async (userId, planId) => {
      const { scenario } = parse(userId);
      if (['control', 'unpriced', 'refunding'].includes(scenario)) throw problem('当前演示状态不允许开通');
      if (!['monthly', 'yearly'].includes(planId)) throw problem('请选择有效套餐', 400);
      return { id: 'demo-quote', expiresAt: now() + 300000, plan: demoCatalog('unpaid').plans.find(plan => plan.id === planId), contracts: contracts(planId) };
    },
    order: async userId => order(userId),
    createOrder: async () => { throw problem('本地演示不能创建真实订单', 403); },
    recordEvent: async () => {},
  };
  const identity = { user: async request => {
    const { scenario, planId } = session(request);
    if (scenario === 'anonymous') throw problem('请先登录', 401);
    return `${scenario}:${planId}`;
  } };
  async function handle(request, response) {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith('/__preview/')) return false;
    const send = (status, value, headers = {}) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers }); response.end(JSON.stringify(value)); };
    if (request.method === 'GET' && url.pathname === '/__preview/state') {
      const current = session(request);
      send(200, { ...current, scenarios: SCENARIOS, priceLabel: preview.label, catalog: demoCatalog(current.scenario) }); return true;
    }
    if (request.method !== 'POST' || request.headers.origin !== `http://${request.headers.host}`) { send(403, { error: '演示操作来源无效' }); return true; }
    let raw = '';
    for await (const chunk of request) { raw += chunk; if (raw.length > 2000) { send(413, { error: '演示请求过大' }); return true; } }
    let body;
    try { body = JSON.parse(raw); } catch { send(400, { error: '演示请求无效' }); return true; }
    const current = session(request);
    let scenario;
    if (url.pathname === '/__preview/scenario') scenario = body.scenario;
    else if (url.pathname === '/__preview/action') {
      scenario = { login: 'unpaid', logout: 'anonymous', checkout: 'pending', pay: 'activating', complete: 'active', fail: 'partial', retry: 'active', close: 'closed', restore: current.scenario === 'refunded' ? 'refund-restored' : 'restored', refund: 'refunded' }[body.action];
    }
    if (!validScenarios.has(scenario)) { send(400, { error: '请选择有效演示状态' }); return true; }
    const planId = body.planId === 'yearly' ? 'yearly' : body.planId === 'monthly' ? 'monthly' : current.planId;
    send(200, { ok: true, scenario, planId }, { 'set-cookie': cookie(scenario, planId) }); return true;
  }
  return { service, identity, handle, session };
}
