export const formatMoney = cents => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100);
export const formatDate = at => Number.isFinite(Number(at)) && at !== null ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' }).format(Number(at)) : '待确认';

export function quotaText(quota) {
  const labels = { credits: '套餐点数', monthly: '月度点数', extra: '加购／赠送点数', independent_credits: '独立点数', projects: '套餐项目包', purchased_projects: '独立项目包', tools: '工具次数' };
  return Object.entries(quota || {}).map(([unit, value]) => unit.endsWith('transcription_seconds') ? `${unit.startsWith('independent_') ? '独立转写' : '套餐转写'} ${Number((Number(value) / 3600).toFixed(1))} 小时` : `${labels[unit] || unit} ${value}`).join(' · ');
}

export function planQuota(product, planId, { compact = false } = {}) {
  const grants = product.grants?.[planId];
  if (!grants?.length) {
    if (product.id === 'aiprd' && product.verified !== true) return planId === 'yearly' ? '功能、积分及到账规则待产品方确认' : '功能与积分待产品方确认';
    return '具体额度待公布';
  }
  return grants.map(grant => {
    const amount = grant.unit === 'transcription_seconds' ? `${grant.amount / 3600} 小时转写` : `${grant.amount} ${ { credits: '点', projects: '个项目包', tools: '次工具额度' }[grant.unit] || grant.unit }`;
    if (grant.schedule === 'upfront') return `${amount} · 一次到账 · ${planId === 'yearly' ? '全年可用' : '会员期内可用'}`;
    const expiry = grant.validity === 'membership' ? product.id === 'pattern' && grant.unit === 'projects' ? '会员期内累计，最多 6 个' : '会员期内可用' : '当期结束失效';
    if (planId === 'yearly') return `${amount}／会员月 · 按月到账 · ${expiry}`;
    return compact ? `${amount} · ${expiry}` : `${amount} · 开通后到账 · ${expiry}`;
  }).join('；');
}

export function productProgress(member, product, now = Date.now()) {
  if (Number(member.expiresAt) <= now && ['active','activating'].includes(member.status)) return { ready: false, retrying: false, label: '联合权益已到期 · 等待恢复' };
  const operations = product.operations || [];
  const pending = operations.filter(task => task.status !== 'done');
  const retrying = pending.some(task => task.attempts > 0);
  const restored = ['restoring','expired'].includes(member.status);
  const ready = !pending.length && (operations.length > 0 || ['active', 'expired'].includes(member.status));
  return { ready, retrying, label: pending.length ? retrying ? '同步异常 · 自动重试中' : member.status === 'restoring' ? '正在恢复原会员' : '正在开通权益' : ready ? restored ? product.previous?.remainingMs > 0 ? '原会员已恢复' : '联合权益已结束' : '权益已开通' : '等待服务端确认' };
}

export function membershipView(member, latestOrder, now = Date.now()) {
  if (!member) return { title: '尚未开通联合会员', description: '选好周期后，可逐项核对权益与原会员保留内容。', tone: 'neutral', ready: false };
  const completed = member.products.filter(product => productProgress(member, product, now).ready).length;
  const retrying = member.products.some(product => productProgress(member, product, now).retrying);
  const total = member.products.length;
  const until = formatDate(member.expiresAt);
  if (total !== 5) return { title: '权益状态待确认', description: '五款产品的权益状态尚未完整返回，请稍后刷新，请勿重复购买。', tone: 'warning', completed, total: 5, ready: false };
  if (member.status === 'restoring') return { title: '原会员恢复中', description: `联合权益已结束，已完成 ${completed}／${total} 项恢复。${retrying ? '异常项目正在自动重试。' : '请等待逐项确认。'}`, tone: retrying ? 'warning' : 'neutral', completed, total, ready: false, ended: true };
  if (member.status === 'expired') return { title: latestOrder?.status === 'refunded' ? '联合权益已结束' : '原会员恢复完成', description: `联合权益已于 ${until} 结束；原会员恢复处理已完成。`, tone: 'neutral', completed, total, ready: true, ended: true };
  if (Number(member.expiresAt) <= now) return { title: '联合会员已到期', description: `联合权益已于 ${until} 结束，正在等待原会员恢复确认。`, tone: 'neutral', completed: 0, total, ready: false, ended: true };
  if (completed !== total || member.status !== 'active') return { title: retrying ? '部分权益同步异常' : '支付成功，权益开通中', description: `已完成 ${completed}／${total} 项。${retrying ? '具体产品见下方，系统会自动重试，请勿重复购买。' : '五款产品全部确认后才会显示开通完成。'}`, tone: retrying ? 'warning' : 'neutral', completed, total, ready: false };
  return { title: '五款产品已全部开通', description: `联合会员有效至 ${until}。各产品额度独立计算。`, tone: 'success', completed, total, ready: true };
}

export function orderView(order, now = Date.now()) {
  if (!order) return null;
  const expired = order.status === 'pending' && Number(order.expires_at) <= now;
  const status = expired ? 'expired' : order.status;
  const views = {
    pending: ['等待支付', `请于 ${formatDate(order.expires_at)} 前完成原订单，避免重复下单。`, 'neutral'],
    expired: ['订单已过期', '该订单不能继续支付，可重新核对套餐权益。', 'neutral'],
    closed: ['订单已关闭', '本次订单未开通联合权益，可重新选择套餐。', 'neutral'],
    paid: ['支付成功', '付款已确认，产品权益以各项开通状态为准。', 'success'],
    refunding: ['退款处理中', '整单退款正在处理；权益撤回与原会员恢复进度单独展示。', 'warning'],
    refunded: ['该笔订单已退款', '退款已确认；当前仍可用的会员与恢复情况以下方权益状态为准。', 'neutral'],
  };
  const view = views[status] || ['订单状态待确认', '正在核对，请勿重复支付。', 'warning'];
  return { status, title: view[0], description: view[1], tone: view[2] };
}
