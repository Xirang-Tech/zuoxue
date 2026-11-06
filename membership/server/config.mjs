import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { insist, PRODUCT_ORIGINS, STAGING_PRODUCT_ORIGINS, LOCAL_PRODUCT_ORIGINS, WEBSITE_ORIGIN, LOCAL_WEBSITE_ORIGIN } from '../shared/domain.mjs';
export async function loadConfig(env = process.env) {
  const origin = new URL(env.PUBLIC_ORIGIN || 'http://127.0.0.1:5088').origin;
  const production = env.NODE_ENV === 'production';
  const environment = env.DEPLOYMENT_ENV || (production ? 'production' : 'local');
  insist(['local','integration','staging','production'].includes(environment),503,'config_invalid','部署环境无效');
  const staging = environment === 'staging';
  const integration = environment === 'integration';
  const entryTesting = staging || integration;
  const groups = JSON.parse(env.STAGING_TEST_ACCOUNTS_JSON || '{}');
  insist(groups && !Array.isArray(groups) && typeof groups === 'object',503,'config_invalid','测试账号配置无效');
  insist(entryTesting || Object.keys(groups).length === 0,503,'config_invalid','测试账号覆盖仅允许在测试环境使用');
  for (const [id, group] of Object.entries(groups)) insist(id.length > 0 && id.length <= 128 && ['A','B'].includes(group),503,'config_invalid','测试账号分组无效');
  const identityOrigin = env.IDENTITY_PUBLIC_ORIGIN ? new URL(env.IDENTITY_PUBLIC_ORIGIN).origin : '';
  if (staging) {
    insist(production && origin === 'https://dev-member.zuoxue.com' && identityOrigin === 'https://dev-auth.zuoxue.com' && new URL(env.IDENTITY_SERVICE_URL || 'http://unconfigured').origin === identityOrigin,503,'config_invalid','测试会员服务必须使用专用 HTTPS 与测试身份服务');
    insist(new URL(env.DATABASE_URL || 'postgres://localhost/unconfigured').pathname === '/zuoxue_membership_dev',503,'config_invalid','测试会员服务必须使用独立的 zuoxue_membership_dev 数据库');
    insist(!env.EXPERIMENT_VERSION || env.EXPERIMENT_VERSION.startsWith('union-staging-'),503,'config_invalid','测试实验必须使用独立版本');
    insist(env.SALES_ENABLED !== 'true',503,'config_invalid','测试环境不允许开启真实售卖');
    insist(!Object.entries(env).some(([key,value]) => key.startsWith('WECHAT_') && value),503,'config_invalid','入口联调环境不配置支付凭证');
  }
  if (integration) {
    insist(!production && env.LOCAL_INTEGRATION === '1' && origin === 'http://127.0.0.1:5105' && identityOrigin === 'http://127.0.0.1:5106' && env.IDENTITY_SERVICE_URL === identityOrigin && (!env.HOST || env.HOST === '127.0.0.1'),503,'config_invalid','本地联调仅允许绑定专用本机地址');
    let localDatabase=false;
    try { const url=new URL(env.DATABASE_URL); localDatabase=['postgres:','postgresql:'].includes(url.protocol) && url.hostname==='127.0.0.1' && url.port==='56473' && url.pathname==='/zuoxue_union_local'; } catch { /* Reject without logging credentials. */ }
    insist(localDatabase,503,'config_invalid','本地联调需要专用本机数据库 127.0.0.1:56473/zuoxue_union_local');
    insist(!env.EXPERIMENT_VERSION || env.EXPERIMENT_VERSION.startsWith('union-local-'),503,'config_invalid','本地联调需要独立实验版本');
    insist(env.SALES_ENABLED !== 'true' && !Object.entries(env).some(([key,value])=>key.startsWith('WECHAT_')&&value),503,'config_invalid','本地联调不允许真实支付配置');
  }
  if (production) insist(new URL(origin).protocol === 'https:' && env.DATABASE_URL && env.EXPERIMENT_SALT?.length >= 32 && env.ADMIN_TOKEN?.length >= 32, 503, 'config_invalid', '生产会员服务配置不完整');
  const catalog = JSON.parse(await readFile(env.CATALOG_FILE || fileURLToPath(new URL('../config/catalog.json', import.meta.url)), 'utf8'));
  const clients = JSON.parse(env.PRODUCT_CLIENTS_JSON || '{}');
  const adapters = JSON.parse(env.PRODUCT_ADAPTERS_JSON || '{}');
  for (const [productId, entry] of Object.entries(clients)) insist(typeof entry.token === 'string' && entry.token.length >= 32, 503, 'client_invalid', `${productId} 需要独立的服务间密钥`);
  if (entryTesting) for (const client of Object.values(clients)) client.isTest = true;
  const preview = entryTesting ? JSON.parse(await readFile(new URL('../config/preview.json',import.meta.url),'utf8')) : null;
  const productOrigins = integration ? LOCAL_PRODUCT_ORIGINS : staging ? STAGING_PRODUCT_ORIGINS : PRODUCT_ORIGINS;
  const websiteOrigin = integration ? LOCAL_WEBSITE_ORIGIN : WEBSITE_ORIGIN;
  return { production, environment, origin, productOrigins, websiteOrigin, host: env.HOST || '127.0.0.1', port: Number(env.PORT || 5088), databaseUrl: env.DATABASE_URL, catalog, clients, adapters: entryTesting ? {} : adapters, adminToken: env.ADMIN_TOKEN, experiment: { environment, origin, productOrigins, websiteOrigin, testGroups: groups, displayPricing: preview ? { prices: preview.prices, label: preview.label } : null, version: env.EXPERIMENT_VERSION || (integration ? 'union-local-v1' : staging ? 'union-staging-v1' : 'union-v1'), salt: env.EXPERIMENT_SALT || 'local-disabled-experiment', experimentEnabled: env.EXPERIMENT_ENABLED === 'true', salesEnabled: !entryTesting && env.SALES_ENABLED === 'true' }, identity: { url: env.IDENTITY_SERVICE_URL, token: env.IDENTITY_SERVICE_TOKEN, rpKey: env.IDENTITY_SERVICE_RP_KEY || 'zuoxue-membership', publicOrigin: identityOrigin }, wechat: { origin, appId: env.WECHAT_APP_ID, mchId: env.WECHAT_MCH_ID, serial: env.WECHAT_CERT_SERIAL, privateKeyFile: env.WECHAT_PRIVATE_KEY_FILE, platformSerial: env.WECHAT_PLATFORM_SERIAL, platformKeyFile: env.WECHAT_PLATFORM_PUBLIC_KEY_FILE, apiKey: env.WECHAT_API_V3_KEY } };
}
