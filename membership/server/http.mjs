import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { MEDIA_FILES } from '../public/media.js';
import { insist, PRODUCT_IDS, PRODUCT_ORIGINS, sameSecret, WEBSITE_ORIGIN } from '../shared/domain.mjs';

const assetRoot = fileURLToPath(new URL('../public/', import.meta.url));
const staticFiles = new Set(['/','/account','/app.js','/showcase.js','/media.js','/member-view.js','/styles.css','/widget.js', ...MEDIA_FILES, '/media/favicon.png']);
async function readBody(request) {
  let text = '';
  for await (const chunk of request) { text += chunk.toString(); insist(Buffer.byteLength(text) <= 64_000, 413, 'body_too_large', '请求过大'); }
  return text;
}
function send(response, status, data, headers = {}) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); response.end(JSON.stringify(data)); }
export function createMembershipServer({ service, identity, config, previewHandler }) {
  const loginAttempts = new Map();
  const identityOrigin = config.identity.publicOrigin ? new URL(config.identity.publicOrigin).origin : '';
  return createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'same-origin');
    response.setHeader('content-security-policy', `default-src 'self'; script-src 'self'; style-src 'self'${config.preview ? " 'unsafe-inline'" : ''}; img-src 'self' data:; connect-src 'self'${identityOrigin ? ' ' + identityOrigin : ''}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    try {
      const url = new URL(request.url, config.origin);
      if (config.preview && previewHandler && await previewHandler(request, response)) return;
      if (config.preview && request.method === 'GET' && url.pathname === '/preview-controls.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        response.end(await readFile(`${assetRoot}preview-controls.js`)); return;
      }
      if (config.preview && request.method==='GET' && ['/paywall-preview','/paywall-preview.js'].includes(url.pathname)) {
        const file=url.pathname==='/paywall-preview'?'paywall-preview.html':'paywall-preview.js';
        response.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store'});response.end(await readFile(`${assetRoot}${file}`));return;
      }
      if (request.method === 'GET' && staticFiles.has(url.pathname)) {
        const accountPage = url.pathname === '/account';
        const file = url.pathname === '/' || accountPage ? 'index.html' : url.pathname.slice(1);
        const content = await readFile(`${assetRoot}${file}`);
        const type = file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.jpg') ? 'image/jpeg' : 'text/html; charset=utf-8';
        response.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
        response.end(accountPage ? content.toString().replace('class="membership-center"', 'class="membership-center" data-website-entry') : content);
        return;
      }
      if (url.pathname === '/health') return send(response, 200, { ok: true });
      if (url.pathname === '/ready') { await service.db.query('SELECT 1 FROM union_orders LIMIT 1'); return send(response, 200, { ok: true, salesEnabled: config.experiment.salesEnabled && !service.problems().length }); }
      if (url.pathname === '/api/website-entry') {
        const origin = request.headers.origin;
        insist(origin === 'https://zuoxue.com', 403, 'origin_rejected', '请求来源无效');
        response.setHeader('access-control-allow-origin', origin);
        response.setHeader('access-control-allow-credentials', 'true');
        response.setHeader('vary', 'Origin');
        if (request.method === 'OPTIONS') { response.setHeader('access-control-allow-methods','GET'); response.writeHead(204); response.end(); return; }
        insist(request.method === 'GET', 405, 'method_not_allowed', '请求方法无效');
        const userId = await identity.user(request);
        return send(response, 200, {...await service.offers(userId), centerUrl:config.origin});
      }
      if (url.pathname.startsWith('/api/payments/wechat/') && request.method === 'POST') {
        insist(!['staging','integration'].includes(config.environment),403,'staging_transactions_disabled','测试环境不处理真实支付或退款');
        const raw = await readBody(request);
        service.payments.verify(raw, request.headers);
        const event = service.payments.decrypt(raw);
        if (url.pathname.endsWith('/payment')) await service.acceptPayment(service.payments.payment(event));
        else { insist(url.pathname.endsWith('/refund'), 404, 'not_found', '接口不存在'); await service.acceptRefund(event); }
        response.writeHead(204); response.end(); return;
      }
      if (url.pathname.startsWith('/internal/')) {
        const token = request.headers.authorization?.replace(/^Bearer /, '') || '';
        const client = Object.entries(config.clients).find(([, value]) => sameSecret(value.token, token));
        insist(client && PRODUCT_IDS.includes(client[0]), 401, 'client_required', '服务间身份验证失败');
        insist(request.method === 'POST', 405, 'method_not_allowed', '请使用 POST');
        const body = JSON.parse(await readBody(request) || '{}');
        insist(typeof body.centralUserId === 'string' && body.centralUserId.length <= 128 && body.centralUserId, 400, 'invalid_user', '中心账号无效');
        if (url.pathname === '/internal/enroll') { await service.enroll(body.centralUserId, client[0], { baselineStatus: body.baselineStatus || 'unknown', isTest: client[1].isTest === true }); return send(response, 200, { ...await service.offers(body.centralUserId), centerUrl:config.origin }); }
        if (url.pathname === '/internal/eligibility') return send(response, 200, { ...await service.offers(body.centralUserId), centerUrl: config.origin });
        if (url.pathname === '/internal/events') { await service.recordEvent(body.centralUserId, client[0], body.name, body.context, body.id, body.occurredAt); return send(response, 200, { ok: true }); }
        if (url.pathname === '/internal/receipts') {
          insist(['payment','refund','cost'].includes(body.kind) && Number.isSafeInteger(body.amountCents) && body.amountCents >= 0 && typeof body.orderId === 'string' && typeof body.id === 'string' && Number.isSafeInteger(body.occurredAt) && body.occurredAt <= Date.now() + 300_000, 400, 'invalid_receipt', '收支凭证无效');
          await service.db.query('INSERT INTO union_receipts(id,central_user_id,product_id,order_id,kind,amount_cents,occurred_at,is_test) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [`${client[0]}:${body.id}`, body.centralUserId, client[0], body.orderId, body.kind, body.amountCents, body.occurredAt, body.isTest === true || client[1].isTest === true]);
          return send(response, 200, { ok: true });
        }
        insist(false, 404, 'not_found', '接口不存在');
      }
      if (url.pathname.startsWith('/admin/')) {
        insist(sameSecret(request.headers.authorization?.replace(/^Bearer /, ''), config.adminToken), 401, 'admin_required', '管理员身份验证失败');
        if (request.method === 'GET' && url.pathname === '/admin/readiness') return send(response, 200, { problems: service.problems() });
        if (request.method === 'GET' && url.pathname === '/admin/report') return send(response, 200, await service.report());
        if (request.method === 'POST' && url.pathname === '/admin/refunds') {
          const body = JSON.parse(await readBody(request) || '{}');
          insist(typeof body.actor === 'string' && body.actor.trim().length >= 2, 400, 'actor_required', '请记录审核人');
          return send(response, 200, await service.prepareRefund(body.orderId, body.actor));
        }
        insist(false, 404, 'not_found', '接口不存在');
      }
      if (request.method !== 'GET') insist(request.headers.origin === config.origin, 403, 'origin_rejected', '请求来源无效');
      if (request.method === 'GET' && url.pathname === '/api/config') return send(response, 200, { rpKey: config.identity.rpKey, identityOrigin, productOrigins: config.productOrigins || PRODUCT_ORIGINS, websiteOrigin: config.websiteOrigin || WEBSITE_ORIGIN, environment: config.environment || 'local', preview: config.preview === true });
      if (request.method === 'POST' && ['/api/auth/login','/api/auth/consume'].includes(url.pathname)) {
        const ip = request.socket.remoteAddress;
        const attempt = loginAttempts.get(ip) || { count: 0, until: 0 };
        if (attempt.until < Date.now()) { attempt.count = 0; attempt.until = Date.now() + 600_000; }
        insist(++attempt.count <= 20, 429, 'too_many_attempts', '尝试过于频繁，请稍后重试');
        if (loginAttempts.size > 10_000) for (const [key, value] of loginAttempts) if (value.until < Date.now()) loginAttempts.delete(key);
        loginAttempts.set(ip, attempt);
        const body = JSON.parse(await readBody(request) || '{}');
        if (url.pathname.endsWith('/consume')) insist(typeof body.ticket === 'string' && body.ticket.length <= 2000, 400, 'invalid_ticket', '登录凭证无效');
        const session = await identity.login(body);
        return send(response, 200, { ok: true, establishCode: session.establishCode }, { 'set-cookie': `zuoxue_member_session=${session.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${config.production ? '; Secure' : ''}` });
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') { await identity.logout(request); return send(response, 200, { ok: true }, { 'set-cookie': 'zuoxue_member_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' }); }
      const userId = await identity.user(request);
      if (request.method === 'GET' && url.pathname === '/api/me') return send(response, 200, await service.offers(userId));
      if (request.method === 'GET' && url.pathname === '/api/membership') return send(response, 200, { membership: await service.status(userId) });
      if (request.method === 'GET' && url.pathname === '/api/orders') {
        const pending = (await service.db.query("SELECT * FROM union_orders WHERE central_user_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", [userId])).rows[0] || null;
        const latest = (await service.db.query('SELECT * FROM union_orders WHERE central_user_id=$1 ORDER BY created_at DESC LIMIT 1', [userId])).rows[0] || null;
        return send(response, 200, { pending, latest });
      }
      if (request.method === 'POST' && url.pathname === '/api/quotes') { const body = JSON.parse(await readBody(request) || '{}'); return send(response, 200, await service.quote(userId, body.planId)); }
      if (request.method === 'POST' && url.pathname === '/api/orders') { const body = JSON.parse(await readBody(request) || '{}'); const order = await service.createOrder(userId, body.quoteId, request.headers['idempotency-key'], body.attribution); return send(response, 200, { order: await service.checkout(userId, order.id) }); }
      const orderMatch = /^\/api\/orders\/(uo_[a-f0-9]+)(\/qr|\/close)?$/.exec(url.pathname);
      if (orderMatch) {
        let order = await service.order(userId, orderMatch[1]);
        if (request.method === 'POST' && orderMatch[2] === '/close') {
          insist(!['staging','integration'].includes(config.environment),403,'staging_transactions_disabled','测试环境不处理真实订单');
          const remote = await service.payments.query(order.id);
          if (remote.trade_state === 'SUCCESS') { await service.acceptPayment(service.payments.payment(remote)); }
          else { await service.payments.close(order.id); await service.db.query("UPDATE union_orders SET status='closed' WHERE id=$1 AND status='pending'", [order.id]); }
          return send(response, 200, { ok: true });
        }
        insist(request.method === 'GET', 405, 'method_not_allowed', '请求方法无效');
        if (orderMatch[2] === '/qr') {
          insist(!config.preview && !['staging','integration'].includes(config.environment), 403, 'preview_payment_disabled', '演示或测试环境不生成付款码');
          insist(order.status === 'pending' && Number(order.expires_at) > Date.now(), 409, 'order_expired', '订单已结束');
          if (!order.code_url) order = await service.checkout(userId, order.id);
          const svg = await QRCode.toString(order.code_url, { type: 'svg', width: 240 });
          response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }); response.end(svg); return;
        }
        if (order.status === 'pending' && !['staging','integration'].includes(config.environment)) {
          const remote = await service.payments.query(order.id);
          if (remote.trade_state === 'SUCCESS') { await service.acceptPayment(service.payments.payment(remote)); order = await service.order(userId, order.id); }
          else if (Number(order.expires_at) <= Date.now()) { await service.payments.close(order.id); await service.db.query("UPDATE union_orders SET status='closed' WHERE id=$1 AND status='pending'", [order.id]); order = await service.order(userId, order.id); }
        }
        return send(response, 200, { order });
      }
      if (request.method === 'POST' && url.pathname === '/api/events') {
        const body = JSON.parse(await readBody(request) || '{}');
        insist(!['core_task_completed','cost_unavailable'].includes(body.name), 403, 'server_event_required', '业务结算事件仅由产品服务端上报');
        await service.recordEvent(userId, body.productId, body.name, body.context, body.id); return send(response, 200, { ok: true });
      }
      insist(false, 404, 'not_found', '接口不存在');
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 503);
      if (!error.status && !(error instanceof SyntaxError)) console.error(JSON.stringify({ event: 'union_request_failed', path: request.url?.split('?')[0] }));
      send(response, status, { error: error.status ? error.message : status === 400 ? '请求格式无效' : '服务暂时不可用，请稍后重试', code: error.code || 'unavailable' });
    }
  });
}
