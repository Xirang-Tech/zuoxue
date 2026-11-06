import { createShowcase } from './showcase.js';
import { formatMoney as money, formatDate as date, quotaText, planQuota, productProgress, membershipView, orderView } from './member-view.js';
const $ = selector => document.querySelector(selector);
const source = new URLSearchParams(location.search);
const websiteEntry = location.pathname === '/account';
const sourceProduct = websiteEntry ? null : source.get('product');
const entry = websiteEntry ? 'website' : ['paywall', 'account'].includes(source.get('entry')) ? source.get('entry') : 'direct';
const showcase = createShowcase(sourceProduct);
const fallbackProducts = [
  ['keban','课伴','Pro','听课转写、知识点与学习笔记'],['aiprd','AI PRD','个人专业档','需求文档、流程图与可点击原型'],['aipm','AI PM 作品集','专业版','作品设计、Demo 与面试准备'],['workflow','Vibe Workflow','专业版','自然语言搭工作流、模拟与导出'],['pattern','产品范式','顾问 Pro','范式诊断、产品方案与汇报材料'],
];
let state = { planId: 'monthly', catalog: null, visible: false, purchasable: false, loggedIn: false, preview: false, quote: null, order: null, latest: null, pending: null, poll: null, membershipPoll: null, member: null, busy: false };
let demo = null;
async function api(path, body, headers = {}) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { ...(body === undefined ? {} : {'content-type':'application/json'}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || '请求暂时无法完成'); error.status = response.status; throw error; }
  return data;
}
function el(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
function notice(message) { $('#notice').textContent = message; $('#notice').hidden = !message; }
function event(name, context = {}) {
  if (!state.loggedIn || state.preview) return;
  void api('/api/events', { productId: websiteEntry ? 'website' : sourceProduct || 'keban', name, context: { ...context, entry } }).catch(() => {});
}
const hasSource = () => Object.hasOwn(config.productOrigins || {}, sourceProduct);
const memberView = () => membershipView(state.member, state.latest);
const priced = plan => Number.isSafeInteger(plan?.priceCents) && plan.priceCents > 0;
function displayPlan(id) {
  const plan = state.catalog?.plans.find(item => item.id === id);
  const demoPrice = state.staging ? state.displayPricing?.prices?.[id] : null;
  return Number.isSafeInteger(demoPrice) && demoPrice > 0 ? { ...plan, priceCents: demoPrice } : plan;
}
const renewable = () => state.purchasable && state.latest?.status !== 'refunding' && (!state.member || ['active','expired'].includes(state.member.status));
function products() {
  const items = state.catalog?.products || fallbackProducts.map(([id,name,tierName,description]) => ({id,name,tierName,description,verified:false,quotaDescription:'具体额度将在开放购买前公布'}));
  const ordered = [...items].sort((a,b) => Number(b.id === sourceProduct) - Number(a.id === sourceProduct));
  showcase.update(ordered,state.planId);
  const rows = $('#entitlement-rows'); rows.replaceChildren();
  for (const product of ordered) {
    const row = el('tr'); const heading = el('th'); heading.scope = 'row';
    const title = el('div',undefined,'entitlement-product');
    title.append(el('strong',product.name),el('span',product.tierName,'tier'));
    heading.append(title);
    if (product.description) heading.append(el('p',product.description,'entitlement-feature'));
    row.append(heading);
    for (const planId of ['monthly','yearly']) {
      const cell = el('td',undefined,planId === state.planId ? 'selected-quota' : '');
      cell.append(el('span',planId === 'monthly' ? '月卡' : '年卡','quota-mobile-label'));
      if (product.id === 'aiprd' && product.verified !== true) cell.append(el('strong','权益待确认','quota-pending'));
      cell.append(el('span',planQuota(product,planId)));
      row.append(cell);
    }
    rows.append(row);
  }
  for (const id of ['monthly','yearly']) {
    const plan = displayPlan(id);
    $('#details-' + id).setAttribute('aria-pressed',String(state.planId === id));
    $('#details-' + id + '-price').textContent = priced(plan) ? `${money(plan.priceCents)}／${id === 'monthly' ? '月卡' : '年卡'}${state.preview || state.displayPricing ? ' · 演示价' : ''}` : '价格待公布';
    $('#' + id + '-column').textContent = `联合${id === 'monthly' ? '月卡' : '年卡'}${id === state.planId ? ' · 已选' : ''}`;
    $('#' + id + '-column').classList.toggle('selected-quota',id === state.planId);
  }
}
function renderOwned() {
  const member = state.member; $('#owned').hidden = !member;
  if (!member) return;
  const view = memberView();
  $('#owned-title').textContent = view.ended ? '会员到期与恢复情况' : '你的联合会员';
  $('#owned-expiry').textContent = `${member.status === 'expired' || member.status === 'restoring' ? '联合权益结束于' : '有效至'} ${date(member.expiresAt)}`;
  const list = $('#owned-products'); list.replaceChildren();
  for (const product of member.products) {
    const progress = productProgress(member,product);
    const item = el('article',undefined,'owned-item');
    const tier = view.ended && progress.ready ? product.previous?.tierName || '原档位待确认' : view.ended && member.status === 'restoring' ? `待恢复：${product.previous?.tierName || '原档位'}` : product.tierName;
    item.append(el('strong',product.name),el('p',tier,'owned-tier'),el('span',progress.label,`status-badge ${progress.retrying ? 'warning' : progress.ready ? 'success' : 'neutral'}`));
    item.append(el('p',product.remainingQuota === null || product.remainingQuota === undefined ? '余额暂时无法读取，请稍后重试' : Object.keys(product.remainingQuota).length ? quotaText(product.remainingQuota) : '无可用套餐余额'));
    if (product.previous?.remainingMs > 0) {
      const days = Math.ceil(product.previous.remainingMs / 86400000);
      item.append(el('p',view.ended && progress.ready ? `已接续原 ${product.previous.tierName} 剩余约 ${days} 天（恢复时长）` : view.ended ? `待恢复原 ${product.previous.tierName} 约 ${days} 天` : `保留原 ${product.previous.tierName} 约 ${days} 天，预计 ${date(member.expiresAt)} 后恢复`,'preserved-note'));
    }
    if (progress.ready) { const link = el('a','去使用 ↗'); link.href = product.url; item.append(link); }
    list.append(item);
  }
  $('#continue-task').hidden = !view.ready;
  $('#continue-task').textContent = hasSource() ? member.status === 'expired' ? '返回原产品继续使用 ↗' : '返回原任务继续使用 ↗' : '选择上方产品开始使用';
}
function renderAccount() {
  const order = orderView(state.latest); const member = state.member; const view = member ? memberView() : order;
  $('#account-panel').hidden = !view;
  if (!view) return;
  $('#account-panel').dataset.tone = view.tone;
  const refund = order && ['refunding','refunded'].includes(order.status);
  if (refund) $('#account-panel').dataset.tone = order.tone;
  $('#account-title').textContent = refund && member ? `${order.title} · ${view.title}` : view.title;
  $('#account-description').textContent = view.description;
  $('#account-order').textContent = member && order ? `${order.title} · ${money(state.latest.amount_cents)} · ${order.description}` : state.latest ? `${state.latest.snapshot.plan.name} · ${money(state.latest.amount_cents)}${state.preview ? '（演示订单）' : ''}` : '';
  $('#view-order').hidden = !state.latest;
  $('#view-order').textContent = order?.status === 'pending' ? state.preview ? '继续模拟支付' : '继续支付原订单' : '查看订单详情';
  $('#view-membership').hidden = !member;
}
function render() {
  for (const id of ['monthly','yearly']) {
    const option = displayPlan(id);
    $('#' + id).setAttribute('aria-pressed',String(state.planId === id));
    $('#purchase-' + id + '-price').textContent = priced(option) ? money(option.priceCents) : '价格待公布';
  }
  const plan = displayPlan(state.planId);
  const price = $('#price'); price.replaceChildren();
  const annual = state.planId === 'yearly';
  if (priced(plan)) {
    price.append(el('span',money(plan.priceCents)),el('small',`／${plan.months} 个月${annual ? '，一次付清' : ''}`));
    $('#price-note').textContent = annual
      ? `约 ${money(Math.round(plan.priceCents / 12))}／月，适合长期使用。`
      : '适合短期项目，或先用一个月看看。';
  } else { price.textContent = '价格待公布'; $('#price-note').textContent = '套餐开放时间待公布。'; }
  $('#price-disclaimer').hidden = !priced(plan) || (!state.preview && !state.displayPricing);
  $('#checkout-demo-note').hidden = !state.preview;
  const view = memberView(); const order = orderView(state.latest);
  const refundTitle = order && ['refunding','refunded'].includes(order.status) ? order.title : '';
  $('#purchase-state').textContent = state.member ? `${refundTitle ? refundTitle + ' · ' : ''}${view.title}` : order ? order.title : !state.loggedIn ? '登录后查看已有会员与可购权益' : !state.visible ? '当前账号暂未开放' : !priced(plan) ? '套餐准备中 · 暂不可购买' : '尚未开通联合会员';
  $('#purchase-state').dataset.tone = refundTitle ? order.tone : view.tone;
  const button = $('#purchase-button');
  button.disabled = state.busy || (!state.member && state.loggedIn && (!renewable() || !priced(plan)));
  $('#renew-button').hidden = !state.member || !view.ready || !renewable() || !priced(plan);
  $('#renew-button').textContent = state.preview ? '模拟续期联合会员' : '续期联合会员';
  button.textContent = state.member ? view.ready ? hasSource() ? '返回原任务继续使用' : '选择产品，开始使用' : view.ended ? '查看原会员恢复进度' : '查看产品开通进度' : !state.loggedIn ? state.preview ? '模拟登录并查看权益' : '登录查看可选权益 ↗' : order?.status === 'pending' ? state.preview ? '继续模拟支付' : '继续支付原订单' : state.staging ? '测试展示 · 真实购买关闭' : !renewable() || !priced(plan) ? '售卖准备中' : state.preview ? '核对权益，体验模拟开通' : '核对权益并开通 ↗';
  const eligibilityNote = $('#eligibility-note');
  eligibilityNote.textContent = state.preview ? '模拟操作仅供体验，不产生扣款或真实权益。' : !state.loggedIn ? '使用已有佐学账号，查看可购买的会员。' : !state.visible ? '联合会员暂未向当前账号开放，原有套餐仍可使用。' : '';
  eligibilityNote.hidden = !eligibilityNote.textContent;
  $('#login-trigger').textContent = state.preview ? state.loggedIn ? '模拟退出登录' : '模拟登录' : state.loggedIn ? '退出登录' : '登录佐学账号 ↗';
  $('#preview-note').hidden = !state.preview && !state.staging;
  $('#preview-note').textContent = config.environment === 'integration' ? '本地联调 · 身份服务为测试模拟 · 真实下单、支付与权益发放关闭' : state.staging ? '测试环境 · 仅供测试账号联调 · 真实下单、支付与权益发放关闭' : '本地交互演示 · 不支持真实支付';
  const promotional = websiteEntry ? state.loggedIn && state.visible && state.variant === 'B' : !state.loggedIn || state.visible;
  if (websiteEntry) {
    document.documentElement.toggleAttribute('data-website-offer', promotional);
    $('#website-account-login').hidden = state.loggedIn;
    $('#website-account-status').textContent = !state.loggedIn ? '使用佐学账号登录，查看会员与订单。' : state.member || state.latest ? '已登录佐学账号，可在下方查看会员或订单。' : '已登录佐学账号，当前暂无会员与订单。';
  }
  for (const id of ['products','products-link','all-entitlements-link','benefit-strip','reasons','closing','plan-details','purchase-cycle','purchase-pricing','purchase-benefits']) $('#' + id).hidden = !promotional;
  const closedMessage = '联合会员目前限量开放。你仍可返回各产品，继续使用或购买原有套餐。';
  if (!promotional && !websiteEntry) notice(closedMessage);
  if (promotional) { if ($('#notice').textContent === closedMessage) notice(''); products(); }
  renderOwned(); renderAccount();
  $('#mobile-action').hidden = !promotional && !state.member;
  $('#mobile-title').textContent = state.member ? refundTitle || view.title : '佐学联合大会员';
  $('#mobile-price').textContent = state.member ? `${view.ended ? '已结束于 ' : '有效至 '}${date(state.member.expiresAt)}` : priced(plan) ? `${money(plan.priceCents)} / ${state.planId === 'yearly' ? '年卡' : '月卡'}${state.preview || state.displayPricing ? ' · 演示价' : ''}` : '价格待公布';
  $('#mobile-link').href = state.member ? view.ready && hasSource() ? $('#continue-task').href : '#owned' : '#purchase';
  $('#mobile-link').textContent = state.member ? view.ready ? hasSource() ? '返回原任务' : '选择产品使用' : view.ended ? '查看恢复进度' : '查看开通进度' : '查看会员套餐';
}
async function membership() {
  const data = await api('/api/membership'); state.member = data.membership;
  if (state.member && (['activating','restoring'].includes(state.member.status) || state.member.products.some(p => !productProgress(state.member,p).ready))) {
    if (!state.membershipPoll && !state.preview) state.membershipPoll = setInterval(() => void membership().catch(() => {}),4000);
  } else { clearInterval(state.membershipPoll); state.membershipPoll = null; }
  render();
}
async function refresh() {
  try {
    const offer = await api('/api/me'); state = {...state,...offer,displayPricing:offer.displayPricing || null,loggedIn:true};
    const orders = await api('/api/orders'); state.pending = orders.pending; state.latest = orders.latest || orders.pending;
    await membership();
  } catch (error) {
    if (error.status === 401) { state.loggedIn = false; state.member = null; state.latest = null; state.pending = null; state.displayPricing = null; state.catalog = demo?.catalog || null; state.visible = false; state.purchasable = false; }
    else notice(`${error.message}。请刷新重试，已付款请勿重复支付。`);
  }
  render(); event('center_viewed');
}
for (const planId of ['monthly','yearly']) for (const id of [planId,'details-' + planId]) $('#' + id).addEventListener('click',() => { state.planId = planId; render(); event('plan_selected',{planId}); });
$('#preserve-link').addEventListener('click',() => { $('#rules').scrollIntoView(); $('#rules details').open = true; });
document.querySelectorAll('.dialog-close').forEach(button => button.addEventListener('click',() => button.closest('dialog').close()));
$('#login-trigger').addEventListener('click',async () => {
  if (demo) { await demo.action(state.loggedIn ? 'logout' : 'login'); return; }
  if (state.loggedIn) { await api('/api/auth/logout',{}); state.loggedIn = false; state.catalog = null; state.displayPricing = null; state.member = null; state.latest = null; state.pending = null; clearInterval(state.membershipPoll); render(); }
  else $('#login-dialog').showModal();
});
$('#website-account-login').addEventListener('click',() => $('#login-trigger').click());
$('#login-form').addEventListener('submit',async event => {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('[type=submit]'); button.disabled = true; $('#login-error').textContent = '';
  try {
    const values = new FormData(form); const result = await api('/api/auth/login',{identifier:values.get('identifier'),password:values.get('password')}); form.reset();
    if (result.establishCode && config.identityOrigin && location.hostname.endsWith('.zuoxue.com')) await fetch(`${config.identityOrigin}/session/establish`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({rpKey:config.rpKey,code:result.establishCode})}).catch(() => {});
    $('#login-dialog').close(); await refresh();
  } catch (error) { $('#login-error').textContent = error.message; } finally { button.disabled = false; }
});
function quoteRows(contracts, planId) {
  const products = el('ul',undefined,'quote-list');
  products.setAttribute('aria-label','产品权益');
  const retained = el('ul');
  for (const product of contracts) {
    const row = el('li',undefined,'quote-row');
    row.append(el('strong',`${product.name} · ${product.effectiveTierName || product.tierName}`),el('span',planQuota(product,planId,{compact:true})));
    products.append(row);

    const previous = product.previous || {};
    const entries = Object.entries(previous.remainingQuota || {}).filter(([,amount]) => Number(amount) > 0);
    const independent = ([key]) => ['extra','purchased_projects'].includes(key) || key.startsWith('independent_');
    const frozen = Object.fromEntries(entries.filter(entry => !independent(entry)));
    const extra = Object.fromEntries(entries.filter(independent));
    const notes = [];
    if (previous.remainingMs > 0) notes.push(`原${previous.tierName || '会员'}剩余约 ${Math.ceil(previous.remainingMs / 86400000)} 天，联合会员结束后接续`);
    if (Object.keys(frozen).length) notes.push(`冻结保留 ${quotaText(frozen)}`);
    if (Object.keys(extra).length) notes.push(`独立额度 ${quotaText(extra)}，按原有效期使用`);
    if (notes.length) {
      const item = el('li');
      item.append(el('strong',product.name),el('span',notes.join('；')));
      retained.append(item);
    }
  }
  const content = $('#quote-content');
  content.replaceChildren(products);
  if (retained.childElementCount) {
    const section = el('section',undefined,'quote-retained');
    section.append(el('h3','原权益保留'),retained);
    content.append(section);
  }
}
function checkoutTotal(planName, amount, meta) {
  $('#checkout-plan').textContent = planName;
  $('#checkout-amount').textContent = money(amount);
  $('#checkout-meta').textContent = meta;
}
function showCheckout() {
  if (!$('#checkout-dialog').open) $('#checkout-dialog').showModal();
  $('#checkout-body').scrollTop = 0;
}
async function startCheckout() {
  if (!state.loggedIn) { if (demo) await demo.action('login'); else $('#login-dialog').showModal(); return; }
  if (orderView(state.pending)?.status === 'pending') { await openOrder(state.pending); return; }
  if (state.pending && !state.preview) { state.order = state.pending; await poll(); if (state.pending) return; }
  if (!renewable() || state.busy) return;
  state.busy = true; render();
  try {
    state.quote = await api('/api/quotes',{planId:state.planId}); state.order = null;
    quoteRows(state.quote.contracts,state.quote.plan.id);
    checkoutTotal(state.quote.plan.name,state.quote.plan.priceCents,`一次性购买，到期不自动扣款。报价有效至 ${date(state.quote.expiresAt)}。`);
    $('#agreement').checked = false; $('#agreement').closest('label').hidden = false; $('#pay-button').disabled = true; $('#pay-button').hidden = false; $('#pay-button').textContent = state.preview ? '确认演示订单' : '确认并获取付款码'; $('#payment').hidden = true; $('#checkout-error').textContent = '';
    $('#checkout-title').textContent = '确认开通联合会员'; showCheckout(); event('checkout_started',{planId:state.planId});
  } catch (error) { notice(error.message); } finally { state.busy = false; render(); }
}
$('#purchase-button').addEventListener('click',() => {
  if (state.member) { if (memberView().ready && hasSource()) location.assign($('#continue-task').href); else $('#owned').scrollIntoView(); return; }
  void startCheckout();
});
$('#renew-button').addEventListener('click',() => void startCheckout());
$('#agreement').addEventListener('change',() => { $('#pay-button').disabled = !$('#agreement').checked; });
$('#pay-button').addEventListener('click',async () => {
  if (!$('#agreement').checked || !state.quote) return;
  $('#pay-button').disabled = true;
  if (demo) { await demo.action('checkout',state.quote.plan.id); return; }
  let attempt;
  try { attempt = JSON.parse(sessionStorage.getItem('union-pending-order')); } catch { /* Recover from a stale local value without losing the server order. */ }
  if (!attempt || attempt.quoteId !== state.quote.id) attempt = { quoteId: state.quote.id, key: crypto.randomUUID() };
  sessionStorage.setItem('union-pending-order',JSON.stringify(attempt));
  try {
    const data = await api('/api/orders',{quoteId:state.quote.id,attribution:{productId:sourceProduct,entry,returnUrl:websiteEntry ? undefined : source.get('return')}},{'idempotency-key':attempt.key});
    state.order = data.order; sessionStorage.setItem('union-pending-order',JSON.stringify({...attempt,orderId:state.order.id}));
    state.pending = data.order; state.latest = data.order; render(); await openOrder(data.order);
  } catch (error) { $('#checkout-error').textContent = error.message; $('#pay-button').disabled = false; }
});
function paymentState() {
  const order = state.order; if (!order) return;
  const view = orderView(order);
  $('#payment-status').textContent = `${view.title}。${view.description}`;
  const pending = view.status === 'pending';
  const processing = pending || view.status === 'refunding';
  $('#payment-qr').hidden = !pending || state.preview;
  $('#demo-payment').hidden = !pending || !state.preview;
  $('#close-order').hidden = !pending;
  $('#refresh-order').hidden = state.preview || !processing;
  if (!processing) { clearInterval(state.poll); state.poll = null; }
}
async function openOrder(order) {
  state.order = order;
  $('#checkout-title').textContent = state.preview ? '演示订单状态' : '订单状态';
  quoteRows(order.snapshot.contracts || [],order.snapshot.plan.id);
  $('#quote-content').prepend(el('p','该订单购买时的权益清单','muted'));
  checkoutTotal(order.snapshot.plan.name,order.amount_cents,`订单号：${order.id}${state.preview ? '（演示）' : ''}`);
  $('#pay-button').hidden = true; $('#agreement').closest('label').hidden = true; $('#payment').hidden = false; $('#checkout-error').textContent = '';
  paymentState();
  if (!state.preview && ['pending','refunding'].includes(orderView(order).status)) {
    if (orderView(order).status === 'pending') $('#payment-qr').src = `/api/orders/${order.id}/qr`;
    clearInterval(state.poll); state.poll = setInterval(poll,3000);
  }
  showCheckout();
  if (!state.preview && order.status === 'pending') await poll();
}
async function poll() {
  if (!state.order || document.hidden) return;
  try {
    const data = await api(`/api/orders/${state.order.id}`); state.order = data.order; state.latest = data.order;
    state.pending = data.order.status === 'pending' ? data.order : null;
    paymentState(); render();
    if (state.order.status !== 'pending') { sessionStorage.removeItem('union-pending-order'); await refresh(); }
  } catch (error) { $('#payment-status').textContent = `${error.message}。恢复后继续查询原订单，请勿重复支付。`; }
}
$('#view-order').addEventListener('click',() => void openOrder(state.latest));
$('#refresh-order').addEventListener('click',() => void poll());
$('#demo-pay-success').addEventListener('click',() => { if (demo) void demo.action('pay',state.order?.snapshot.plan.id); });
$('#demo-pay-failure').addEventListener('click',() => { if (demo) $('#payment-status').textContent = '模拟支付失败，尚未开通任何权益。可以重试同一演示订单，或关闭订单。'; });
$('#close-order').addEventListener('click',async () => {
  if (demo) { await demo.action('close'); return; }
  try { await api(`/api/orders/${state.order.id}/close`,{}); clearInterval(state.poll); sessionStorage.removeItem('union-pending-order'); $('#checkout-dialog').close(); await refresh(); }
  catch (error) { $('#checkout-error').textContent = error.message; }
});
const config = await api('/api/config');
state.preview = config.preview;
state.staging = ['staging','integration'].includes(config.environment);
if (state.preview) { const { setupPreview } = await import('./preview-controls.js'); demo = await setupPreview(api,() => state.planId); state.planId = demo.planId; }
if (config.identityOrigin && location.hostname.endsWith('.zuoxue.com') && document.cookie.split(';').some(value => value.trim().startsWith('zx_sso='))) {
  try { const response = await fetch(`${config.identityOrigin}/session/ticket`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({rpKey:config.rpKey})}); if (response.ok) { const ticket = await response.json(); await api('/api/auth/consume',{ticket:ticket.ticket}); } } catch { /* Login remains available when the central session is absent. */ }
}
const returnOrigins = config.productOrigins || {};
if (websiteEntry) {
  const website = new URL(config.websiteOrigin);
  $('#return-link').href = website.href;
  $('.header .brand').href = website.href;
  $('.footer .brand').href = website.href;
  $('#website-products').href = new URL('/#products', website).href;
}
if (hasSource()) { $('#continue-task').href = returnOrigins[sourceProduct]; $('#return-link').href = returnOrigins[sourceProduct]; $('#return-link').textContent = '返回原产品'; }
if (!hasSource()) $('#continue-task').href = '#owned';
const returnUrl = source.get('return');
try { const value = new URL(returnUrl); if (value.origin === returnOrigins[sourceProduct] && !value.username && !value.password && !/token|secret|password|api[_-]?key/i.test(value.hash) && ![...value.searchParams.keys()].some(key => /token|key|secret|password|prompt|content|code/i.test(key))) { $('#continue-task').href = value.href; $('#return-link').href = value.href; $('#return-link').textContent = '返回原产品 ↗'; } } catch { /* Use the default product directory. */ }
await refresh();
if (state.loggedIn && state.pending && orderView(state.pending).status === 'pending') await openOrder(state.pending);
