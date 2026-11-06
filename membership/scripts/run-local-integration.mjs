import { spawn } from 'node:child_process';
import { open, readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { createServer } from 'node:http';
import pg from 'pg';
import { Database } from '../server/database.mjs';
import { migrate } from './migrate.mjs';
import { loadConfig } from '../server/config.mjs';
import { MembershipService } from '../server/service.mjs';
import { createMembershipServer } from '../server/http.mjs';
import { Identity } from '../server/identity.mjs';
import { LOCAL_WEBSITE_ORIGIN } from '../shared/domain.mjs';
import { createLocalIdentityFixture, LOCAL_TEST_USERS, LOCAL_TEST_PASSWORD } from '../integrations/local-identity-fixture.mjs';
import { createLocalEntryProxy } from '../integrations/local-entry-proxy.mjs';
const member=fileURLToPath(new URL('../',import.meta.url));
const base=join(member,'output/local-integration');
const privateConfig=JSON.parse(await readFile(join(base,'private-config.json'),'utf8'));
const database=name=>`postgres://union_local@127.0.0.1:56473/${name}`;
const childEnv={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:'en_US.UTF-8',NODE_ENV:'development',TZ:'Asia/Shanghai',NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost'};
const sources=product=>join(base,'sources',product);
const children=[];const servers=[];const states={};let db;
let closing=false;
async function close(code=0){
 if(closing)return;closing=true;
 for(const child of children)child.kill('SIGTERM');
 for(const server of servers){server.close();server.closeAllConnections?.();}
 await db?.close();process.exit(code);
}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
process.on('uncaughtException',error=>{console.error('本地联调启动失败：',error.message);void close(1);});
process.on('unhandledRejection',error=>{console.error('本地联调启动失败：',error instanceof Error?error.message:'未知错误');void close(1);});
await mkdir(join(base,'logs'),{recursive:true});
async function listen(server,port) {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});servers.push(server);}
// Refuse occupied app ports instead of proxying to another local project.
const websitePort = Number(new URL(LOCAL_WEBSITE_ORIGIN).port);
for(const port of [5100,5101,5102,5103,5104,5105,5106,websitePort,5111,5112,5113,5114,5122,5123,5124]) {
 const probe=createServer();
 await new Promise((resolve,reject)=>{probe.once('error',()=>reject(new Error(`本机端口 ${port} 已占用，请先停止占用它的服务；不会自动终止其他项目。`)));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
}
async function availableRedisPort() {
 for(const port of [56379,0]) {
  const probe=createServer();
  try {await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});}
  catch(error){if(port!==0 && error.code==='EADDRINUSE')continue;throw error;}
  const selected=probe.address().port;await new Promise(resolve=>probe.close(resolve));return selected;
 }
}
const redisPort=await availableRedisPort();
async function start(name,cwd,args,env={},wait=false) {
 const log=await open(join(base,'logs',name+'.log'),'a');
 const processChild=spawn(process.execPath,args,{cwd,env:{...childEnv,...env},stdio:['ignore',log.fd,log.fd]});children.push(processChild);states[name]='启动中';await log.close();
 processChild.once('exit',code=>{states[name]=code===0?'已停止':'启动失败';});
 if(wait)await new Promise((resolve,reject)=>{processChild.once('error',reject);processChild.once('exit',code=>code===0?resolve():reject(new Error(`${name} failed; see its local log`)));});
 return processChild;
}
const common=(product,dbName,rpKey)=>({DATABASE_URL:database(dbName),REDIS_URL:`redis://127.0.0.1:${redisPort}/2`,IDENTITY_SERVICE_URL:'http://127.0.0.1:5106',IDENTITY_SERVICE_TOKEN:privateConfig.identityToken,IDENTITY_SERVICE_RP_KEY:rpKey,UNION_MEMBERSHIP_URL:'http://127.0.0.1:5105',UNION_MEMBERSHIP_TOKEN:privateConfig.productTokens[product],UNION_MEMBERSHIP_ADAPTER_VERIFIED:'false',ALLOW_DEV_AUTH:'0',HOST:'127.0.0.1',AUTH_SECRET:privateConfig.authSecrets[product],SESSION_SECRET:privateConfig.authSecrets[product],JWT_SECRET:privateConfig.authSecrets[product]});
const root=new pg.Pool({connectionString:database('postgres'),max:1});
try {
 const location=(await root.query('SHOW data_directory')).rows[0].data_directory;
 if(location!==join(base,'postgres'))throw new Error('Refusing a different PostgreSQL cluster');
 for(const name of ['zuoxue_union_local','keban_union_local','aipm_union_local','workflow_union_local','pattern_union_local'])if(!(await root.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount)await root.query(`CREATE DATABASE ${name}`);
} finally {await root.end();}
const redisLog=await open(join(base,'logs/redis.log'),'a');
const redis=spawn('/opt/homebrew/opt/redis/bin/redis-server',['--bind','127.0.0.1','--port',String(redisPort),'--save','','--appendonly','no','--protected-mode','yes'],{stdio:['ignore',redisLog.fd,redisLog.fd]});children.push(redis);
await redisLog.close();redis.once('error',error=>{console.error('本地 Redis 启动失败：',error.message);void close(1);});
await listen(createLocalIdentityFixture(privateConfig.identityToken),5106);
const centerEnv={...childEnv,DEPLOYMENT_ENV:'integration',LOCAL_INTEGRATION:'1',HOST:'127.0.0.1',PORT:'5105',PUBLIC_ORIGIN:'http://127.0.0.1:5105',DATABASE_URL:database('zuoxue_union_local'),IDENTITY_SERVICE_URL:'http://127.0.0.1:5106',IDENTITY_PUBLIC_ORIGIN:'http://127.0.0.1:5106',IDENTITY_SERVICE_RP_KEY:'zuoxue-membership-local',IDENTITY_SERVICE_TOKEN:privateConfig.identityToken,STAGING_TEST_ACCOUNTS_JSON:JSON.stringify(Object.fromEntries(LOCAL_TEST_USERS.map((user,index)=>[user.centralUserId,index===0?'A':'B']))),PRODUCT_CLIENTS_JSON:JSON.stringify(Object.fromEntries(Object.entries(privateConfig.productTokens).map(([product,token])=>[product,{token,isTest:true}]))),EXPERIMENT_VERSION:'union-local-v1',EXPERIMENT_SALT:privateConfig.salt,EXPERIMENT_ENABLED:'false',SALES_ENABLED:'false',ADMIN_TOKEN:privateConfig.adminToken};
const config=await loadConfig(centerEnv);db=new Database(config.databaseUrl);await migrate(db);
const closed={configured:()=>false,ready:()=>false};
const service=new MembershipService({db,catalog:config.catalog,adapters:closed,payments:closed,config:config.experiment});
await listen(createMembershipServer({service,identity:new Identity(db,config.identity),config}),5105);
const websiteRoot = new URL('../../', import.meta.url);
const websitePages = new Set(['/index.html','/contact.html','/privacy.html','/terms.html','/qualifications.html']);
const websiteTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };
await listen(createServer(async (request, response) => {
 const pathname = request.url?.split('?')[0];
 const path = pathname === '/' ? '/index.html' : pathname;
 if (!['GET','HEAD'].includes(request.method) || !(websitePages.has(path) || /^\/assets\/[a-z0-9-]+\.(?:js|css|png|svg)$/.test(path))) {
  response.writeHead(404).end();
  return;
 }
 try {
  const content = await readFile(new URL(path.slice(1), websiteRoot));
  response.writeHead(200, {'content-type':websiteTypes[extname(path)], 'cache-control':'no-store', 'x-content-type-options':'nosniff'}).end(content);
 } catch (error) {
  response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
 }
}), websitePort);
for(const [index,frontendPort,backendPort] of [[1,5111,5111],[2,5112,5122],[3,5113,5123],[4,5114,5124]])await listen(createLocalEntryProxy({frontendPort,backendPort}),5100+index);
const links=[['课伴','http://127.0.0.1:5101/billing','付费墙与账号菜单'],['AI PM 作品集','http://127.0.0.1:5102/#billing','会员页与侧栏入口'],['Vibe Workflow','http://127.0.0.1:5103/','登录后打开账号与付费面板'],['产品范式','http://127.0.0.1:5104/pricing','套餐页与账号页']];
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>佐学联合会员 · 本地联调</title><link rel="stylesheet" href="/style.css"><main><p class="eyebrow">佐学联合大会员</p><h1>从四款产品，走进同一个会员中心。</h1><p class="intro">这里运行四款产品的真实界面与接口，使用独立的本地测试数据。身份服务为模拟，支付与 AI 调用关闭。</p><section class="accounts"><h2>先用测试账号登录</h2><p><strong>B 组 · 显示联合会员入口</strong><code>union-b@example.test</code></p><p><strong>A 组 · 隐藏联合会员入口</strong><code>union-a@example.test</code></p><p>测试密码：<code>${LOCAL_TEST_PASSWORD}</code></p><p class="hint">本地需要分别登录各产品与会员中心；真实跨域免登录留待服务器环境验收。</p></section><div class="grid">${links.map(([name,url,description])=>`<a class="card" href="${url}"><h2>${name}</h2><p>${description}</p><span>打开本地产品 →</span></a>`).join('')}</div><div class="other"><a href="http://127.0.0.1:5105/">打开本地联调会员中心 →</a><a href="http://127.0.0.1:5088/">查看原来的 16 种状态演示 →</a></div><section class="steps"><h2>怎样检查</h2><ol><li>用 B 组账号登录一款产品，找到付费墙或账号中的联合会员入口。</li><li>进入会员中心，用同一个测试账号登录，核对来源产品和演示价格。</li><li>点击页面底部“返回原产品”，确认回到刚才的位置。</li></ol><p>更换 A 组账号时，先退出当前账号；A 组不显示联合入口，也不能直接购买。</p></section><p id="status" role="status">正在启动本地产品，首次打开可能需要编译…</p><script src="/status.js"></script></main></html>`;
const css=`:root{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:#302219;background:#fffaf4}*{box-sizing:border-box}body{margin:0}main{max-width:1060px;padding:48px 28px;margin:auto}.eyebrow{color:#a84a14;font-size:14px;font-weight:700}h1{font-size:40px;line-height:1.3;max-width:800px;margin:14px 0}h2{font-size:18px;margin:0 0 13px}.intro{font-size:15px;line-height:1.9;color:#735c4b}.accounts{background:#ffedca;border:1px solid #efcb8a;border-radius:14px;padding:23px;margin:25px 0}.accounts p{line-height:1.9;font-size:13px;margin:10px 0}.accounts strong{display:inline-block;min-width:230px}code{font-family:ui-monospace,monospace;font-size:13px;user-select:all;overflow-wrap:anywhere}.hint{color:#755638}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}a{color:inherit;text-decoration:none}.card{display:block;background:white;border:1px solid #edd8bc;border-radius:13px;padding:23px}.card:hover{border-color:#bd5b20;background:#fff4e6}.card p{font-size:13px;color:#77604f;line-height:1.8}.card span,.other a{font-size:13px;color:#a34413;font-weight:650}.other{display:flex;flex-wrap:wrap;gap:24px;margin:25px 0}.other a{padding:12px 0}.steps{border-top:1px solid #e9d7c0;padding-top:24px;margin-top:25px;font-size:13px;line-height:2}.steps p,#status{color:#78614f;font-size:12px}a:focus-visible{outline:3px solid #b54e16;outline-offset:4px}@media(max-width:600px){main{padding:25px 18px}h1{font-size:29px}.grid{grid-template-columns:1fr}.accounts{padding:18px}.accounts strong{display:block}.other{display:block}.other a{display:block}.card{padding:19px}}`;
await listen(createServer(async(request,response)=>{
 const path=request.url?.split('?')[0];
 if(path==='/status'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(states));return;}
 const content=path==='/style.css'?css:path==='/status.js'?`async function check(){const data=await(await fetch('/status')).json();const failed=Object.values(data).includes('启动失败');document.querySelector('#status').textContent=failed?'部分本地服务启动失败，正在排查，请先保留此页。':'本地服务已启动，首次打开产品可能需要等待编译。'}check();setInterval(check,5000);`:html;
 response.writeHead(200,{'content-type':path==='/style.css'?'text/css; charset=utf-8':path==='/status.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(content);
}),5100);
await writeFile(join(base,'runtime.json'),JSON.stringify({pid:process.pid,hub:'http://127.0.0.1:5100',databasePort:56473,redisPort},null,2));
console.log(`本地联调入口 http://127.0.0.1:5100/ · 佐学官网预览 ${LOCAL_WEBSITE_ORIGIN}/`);
const keban={...common('keban','keban_union_local','ai-course-copilot'),APP_PUBLIC_ORIGIN:'http://127.0.0.1:5101'};
await start('keban-generate',sources('keban'),['node_modules/prisma/build/index.js','generate'],keban,true);
await start('keban-migrate',sources('keban'),['node_modules/prisma/build/index.js','migrate','deploy'],keban,true);
await start('keban',sources('keban'),['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','5111'],keban);
const aipm={...common('aipm','aipm_union_local','ai-pm-workbench'),PORT:'5122',COOKIE_SECURE:'false',VITE_IDENTITY_PUBLIC_ORIGIN:'http://127.0.0.1:5106'};
await start('aipm-migrate',sources('aipm'),['--import','tsx','server/db/migrate.ts'],aipm,true);
await start('aipm-api',sources('aipm'),['--import','tsx','server/index.ts'],aipm);
await start('aipm-web',sources('aipm'),['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5112','--strictPort'],aipm);
const workflow={...common('workflow','workflow_union_local','vibe-workflow'),API_PORT:'5123',API_HOST:'127.0.0.1',VITE_IDENTITY_SSO_ORIGIN:'http://127.0.0.1:5106',ADMIN_JWT_SECRET:privateConfig.authSecrets.workflow,ADMIN_BOOTSTRAP_USERNAME:'union_local_admin',ADMIN_BOOTSTRAP_PASSWORD:privateConfig.adminToken};
await start('workflow-api',sources('workflow'),['server/index.mjs'],workflow);
await start('workflow-web',sources('workflow'),['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5113','--strictPort'],workflow);
const pattern={...common('pattern','pattern_union_local','llm-paradigms'),PORT:'5124',PUBLIC_ORIGIN:'http://127.0.0.1:5104',VITE_COMMERCE_SOURCE:'server',VITE_IDENTITY_PUBLIC_ORIGIN:'http://127.0.0.1:5106'};
await start('pattern-api',sources('pattern'),['server/index.js'],pattern);
await start('pattern-web',sources('pattern'),['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5114','--strictPort'],pattern);
for(const name of Object.keys(states))if(states[name]==='启动中')states[name]='运行中';
