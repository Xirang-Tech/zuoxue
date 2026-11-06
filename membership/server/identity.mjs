import { createHash, randomBytes } from 'node:crypto';
import { insist } from '../shared/domain.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
export class Identity {
  constructor(db, config) { this.db = db; this.config = config; }
  async call(path, body) {
    const c = this.config;
    insist(c.url && c.token && c.rpKey, 503, 'identity_unconfigured', '统一账号尚未配置');
    const response = await fetch(`${c.url.replace(/\/$/, '')}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-internal-token': c.token }, body: body ? JSON.stringify({ rpKey: c.rpKey, ...body }) : undefined, signal: AbortSignal.timeout(8000) });
    if ([400, 401, 403].includes(response.status)) insist(false, 401, 'login_failed', '账号验证失败，请重新登录');
    insist(response.ok, 503, 'identity_unavailable', '统一账号暂时不可用');
    return response.json();
  }
  async login(body) {
    const result = body.ticket ? await this.call('/internal/sessions/consume', { ticket: body.ticket }) : await this.call('/internal/auth/login', { identifier: String(body.identifier || ''), password: String(body.password || '') });
    const userId = result.centralUserId || result.user?.centralUserId;
    insist(userId && (!result.user?.status || result.user.status === 'ACTIVE'), 401, 'login_failed', '账号不可用');
    const epoch = await this.call(`/internal/users/${encodeURIComponent(userId)}/session-epoch`);
    const token = randomBytes(32).toString('hex'), expiresAt = Date.now() + 7 * 86400_000;
    await this.db.query('INSERT INTO union_sessions(token_hash,central_user_id,session_epoch,expires_at) VALUES($1,$2,$3,$4)', [hash(token), userId, epoch.sessionEpoch ?? result.sessionEpoch ?? 0, expiresAt]);
    return { token, expiresAt, establishCode: result.establishCode };
  }
  async user(request) {
    const token = /(?:^|;\s*)zuoxue_member_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '')?.[1];
    insist(token, 401, 'login_required', '请先登录佐学账号');
    const session = (await this.db.query('SELECT * FROM union_sessions WHERE token_hash=$1 AND expires_at>$2', [hash(token), Date.now()])).rows[0];
    insist(session, 401, 'login_required', '登录已失效，请重新登录');
    const epoch = await this.call(`/internal/users/${encodeURIComponent(session.central_user_id)}/session-epoch`);
    insist(epoch.sessionEpoch === session.session_epoch, 401, 'session_revoked', '登录已失效，请重新登录');
    return session.central_user_id;
  }
  async logout(request) {
    const token = /zuoxue_member_session=([a-f0-9]{64})/.exec(request.headers.cookie || '')?.[1];
    if (token) await this.db.query('DELETE FROM union_sessions WHERE token_hash=$1', [hash(token)]);
  }
}
