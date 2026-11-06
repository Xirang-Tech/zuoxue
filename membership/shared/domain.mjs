import { createHmac, timingSafeEqual } from 'node:crypto';

export const PRODUCT_IDS = Object.freeze(['keban', 'aiprd', 'aipm', 'workflow', 'pattern']);
export const PRODUCT_ORIGINS = Object.freeze({ keban: 'https://keban.zuoxue.com', aiprd: 'https://aiprd.zuoxue.com', aipm: 'https://workbench.zuoxue.com', workflow: 'https://vibeworkflow.zuoxue.com', pattern: 'https://pattern.zuoxue.com' });
export const STAGING_PRODUCT_ORIGINS = Object.freeze({ keban: 'https://dev-keban.zuoxue.com', aipm: 'https://dev-workbench.zuoxue.com', workflow: 'https://dev-vibeworkflow.zuoxue.com', pattern: 'https://dev-pattern.zuoxue.com' });
export const LOCAL_PRODUCT_ORIGINS = Object.freeze({ keban: 'http://127.0.0.1:5101', aipm: 'http://127.0.0.1:5102', workflow: 'http://127.0.0.1:5103', pattern: 'http://127.0.0.1:5104' });
export const WEBSITE_ORIGIN = 'https://zuoxue.com';
export const LOCAL_WEBSITE_ORIGIN = 'http://127.0.0.1:5107';
export const EVENT_NAMES = Object.freeze(['paywall_viewed', 'union_impression', 'union_clicked', 'center_viewed', 'plan_selected', 'checkout_started', 'core_task_completed', 'cost_unavailable']);
export class MembershipError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function insist(condition, status, code, message) {
  if (!condition) throw new MembershipError(status, code, message);
}
export function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function assignVariant(centralUserId, version, salt) {
  insist(centralUserId && version && salt, 503, 'experiment_unconfigured', '实验尚未配置');
  return createHmac('sha256', salt).update(`${version}:${centralUserId}`).digest().readUInt32BE(0) % 2 === 0 ? 'A' : 'B';
}
// Anchor every anniversary to the original date, preventing Jan 31 -> Feb 28 -> Mar 28 drift.
export function addMonths(at, months) {
  insist(Number.isFinite(at) && Number.isInteger(months) && months >= 0, 400, 'invalid_period', '权益周期无效');
  const offset = 8 * 60 * 60 * 1000; // Product billing uses Asia/Shanghai calendar dates.
  const start = new Date(at + offset);
  const result = new Date(at + offset);
  result.setUTCDate(1);
  result.setUTCMonth(start.getUTCMonth() + months);
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(start.getUTCDate(), last));
  return result.getTime() - offset;
}
export function safeReturnUrl(value, productId, origins = PRODUCT_ORIGINS, defaultOrigin = 'https://zuoxue.com') {
  const fallback = Object.hasOwn(origins, productId) ? origins[productId] : defaultOrigin;
  try {
    const url = new URL(value || fallback);
    // Only a return location; original task contents and credentials must never travel in URLs.
    if (url.origin !== fallback || url.username || url.password) return fallback;
    if ([...url.searchParams.keys()].some(key => /token|key|secret|password|prompt|content|code/i.test(key))) return fallback;
    if (/token|secret|password|api[_-]?key/i.test(url.hash)) return fallback;
    return url.href;
  } catch { return fallback; }
}
export function catalogProblems(catalog) {
  const errors = [];
  if (!catalog?.version || catalog.approved !== true) errors.push('权益清单未审核');
  if (catalog?.costApproved !== true) errors.push('成本核算未通过');
  if (catalog?.currency !== 'CNY') errors.push('币种必须为 CNY');
  if (!Array.isArray(catalog?.plans) || catalog.plans.length !== 2) errors.push('必须配置月卡和年卡');
  for (const [id, months] of [['monthly', 1], ['yearly', 12]]) {
    const plan = catalog?.plans?.find(item => item.id === id);
    if (!plan || plan.months !== months || !Number.isSafeInteger(plan.priceCents) || plan.priceCents <= 0) errors.push(`${id} 价格或周期未配置`);
  }
  if (catalog?.products?.length !== PRODUCT_IDS.length || new Set(catalog?.products?.map(p => p.id)).size !== PRODUCT_IDS.length) errors.push('必须且只能包含五款产品');
  for (const id of PRODUCT_IDS) {
    const p = catalog?.products?.find(item => item.id === id);
    if (!p?.verified || !p?.tierId || !Number.isSafeInteger(p?.tierRank)) { errors.push(`${id} 权益未核验`); continue; }
    for (const planId of ['monthly', 'yearly']) {
      const grants = p.grants?.[planId];
      if (!Array.isArray(grants) || !grants.length) { errors.push(`${id}/${planId} 额度未配置`); continue; }
      for (const grant of grants) {
        if (!grant.unit || !Number.isSafeInteger(grant.amount) || grant.amount <= 0 || !['monthly', 'upfront'].includes(grant.schedule) || (grant.validity && !['period','membership'].includes(grant.validity))) errors.push(`${id}/${planId} 额度规则无效`);
      }
    }
  }
  return errors;
}
export function effectiveContract(product, current) {
  insist(current?.ready === true, 503, 'product_not_ready', `${product.name} 尚未完成权益接入`);
  insist(current.autoRenewActive === false, 409, 'auto_renew_active', `请先取消 ${product.name} 的自动续费并等待确认`);
  insist(current.pendingSubscriptionOrder === false, 409, 'native_order_pending', `请先确认并关闭 ${product.name} 的待支付订阅订单`);
  insist(current.pendingReservations === 0, 409, 'generation_in_progress', `${product.name} 有任务正在结算，请完成后再开通`);
  insist(Number.isSafeInteger(current.remainingMs) && current.remainingMs >= 0 && Number.isSafeInteger(current.tierRank), 503, 'snapshot_invalid', `${product.name} 的权益状态尚未完整确认`);
  const inherits = current.remainingMs > 0 && current.tierRank > product.tierRank;
  if (inherits) insist(current.highTierVerified === true && current.highTierGrants, 409, 'high_tier_unverified', `${product.name} 的高档权益尚未审核`);
  return {
    ...structuredClone(product),
    effectiveTierId: inherits ? current.tierId : product.tierId,
    effectiveTierName: inherits ? current.tierName : product.tierName,
    effectiveTierRank: inherits ? current.tierRank : product.tierRank,
    grants: structuredClone(inherits ? current.highTierGrants : product.grants),
    previous: { tierId: current.tierId || 'free', tierName: current.tierName || '免费版', remainingMs: Math.max(0, current.remainingMs || 0), remainingQuota: current.remainingQuota || {}, snapshotVersion: current.snapshotVersion },
  };
}
export function grantSchedule(contract, planId, startsAt, endsAt) {
  const items = [];
  for (const grant of contract.grants[planId]) {
    const count = grant.schedule === 'monthly' ? (planId === 'yearly' ? 12 : 1) : 1;
    for (let period = 0; period < count; period++) {
      const at = addMonths(startsAt, period);
      items.push({ unit: grant.unit, amount: grant.amount, period, at, expiresAt: grant.schedule === 'monthly' && grant.validity !== 'membership' ? Math.min(addMonths(startsAt, period + 1), endsAt) : endsAt });
    }
  }
  return items;
}
