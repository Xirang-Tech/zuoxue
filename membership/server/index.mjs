import { Database } from './database.mjs';
import { loadConfig } from './config.mjs';
import { ProductAdapters } from './adapters.mjs';
import { WechatPayments } from './wechat.mjs';
import { Identity } from './identity.mjs';
import { MembershipService } from './service.mjs';
import { createMembershipServer } from './http.mjs';
const config = await loadConfig();
if (!config.databaseUrl) throw new Error('请为会员服务配置独立数据库，并先执行 npm run migrate');
const db = new Database(config.databaseUrl);
await db.query('SELECT 1 FROM union_schema_migrations LIMIT 1');
const service = new MembershipService({ db, catalog: config.catalog, adapters: new ProductAdapters(config.adapters), payments: new WechatPayments(config.wechat), config: config.experiment });
const server = createMembershipServer({ service, identity: new Identity(db, config.identity), config });
let working = false;
const timer = ['staging','integration'].includes(config.environment) ? null : setInterval(async () => {
  if (working) return;
  working = true;
  try { await service.runWorker(); await service.reconcilePayments(); await service.reconcileRefunds(); }
  catch { console.error(JSON.stringify({ event: 'union_worker_failed' })); }
  finally { working = false; }
}, 3000);
timer?.unref();
server.listen(config.port, config.host, () => console.log(`佐学联合会员 http://${config.host}:${config.port}`));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { clearInterval(timer); server.close(async () => { await db.close(); process.exit(0); }); });
