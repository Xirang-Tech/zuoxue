import { spawnSync } from 'node:child_process';
import { mkdir, cp, readFile, writeFile, symlink, stat, rm, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const member=fileURLToPath(new URL('../',import.meta.url));
const base=join(member,'output/local-integration');
const roots={keban:'/Users/t7/Documents/Codex/workspace/ai-course-copilot-fresh',aipm:'/Users/t7/Documents/ChatGPT/AIPM2/ai-pm-workbench',workflow:'/Users/t7/Documents/工作流/VibeWorkflow',pattern:join(member,'../worktrees/pattern-union')};
const reviewed={
 keban:['src/components/union/widget.js','src/app/api/union-membership/events/route.ts'],
 aipm:['src/App.tsx','src/pages/BillingPage.tsx','src/components/union','src/lib/sso.ts','server/union','server/union-client.mjs','server/union-client.d.mts','server/union-membership.ts','server/billing.ts','server/db/schema.ts','server/db/migrations/0007_bored_wallow.sql','server/db/migrations/meta/0007_snapshot.json','server/db/migrations/meta/_journal.json'],
 workflow:['src/App.jsx','src/components/BillingCenter.jsx','src/components/Editor.jsx','src/components/HomeView.jsx','src/components/UnionMembershipOffer.jsx','src/lib/union-widget.js','server/union','server/index.mjs','server/billing-wechat.mjs','server/billing.mjs','server/db.mjs','server/llm.mjs','server/wechat-pay.mjs'],
 pattern:['server/commercePg.js','server/commerceRules.js','server/index.js','server/llmUsage.js','server/schema.sql','server/union','src/TopNav.jsx','src/auth.jsx','src/commerce/CommerceContext.jsx','src/pages/Account.jsx','src/pages/Pricing.jsx','src/styles.css','src/components/UnionMembershipOffer.jsx'],
};
function run(command,args,options={}) {const r=spawnSync(command,args,{...options,maxBuffer:2*1024*1024});if(r.status!==0)throw new Error(`${command}: ${r.stderr?.toString().slice(0,1000)}`);return r.stdout?.toString().trim();}
async function edit(path,from,to) {const s=await readFile(path,'utf8');if(s.split(from).length!==2)throw new Error(`Review changed anchor: ${path}`);await writeFile(path,s.replace(from,to));}
await mkdir(base,{recursive:true});
const manifest={createdAt:new Date().toISOString(),scope:'local entry integration; simulated identity; no financial transactions',bannerAssets:{source:'membership/public/union-media',files:(await readdir(join(member,'public/union-media'))).filter(name=>/\.(svg|webp)$/.test(name))},sources:{}};
for(const [product,root] of Object.entries(roots)) {
 const destination=join(base,'sources',product);
 try {await stat(destination);throw new Error(`Local source already exists: ${destination}`);}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(destination,{recursive:true});
 const archive=join(base,`${product}.tar`);run('git',['-C',root,'archive','--format=tar',`--output=${archive}`,'HEAD']);run('tar',['-xf',archive,'-C',destination]);await rm(archive);
 for(const path of reviewed[product]) {await mkdir(join(destination,path,'..'),{recursive:true});await cp(join(root,path),join(destination,path),{recursive:true,filter:path=>!path.includes('node_modules')&&!/\.test\.[cm]?[jt]sx?$/.test(path)});}
 await cp(join(member,'public/union-media'),join(destination,'public/union-media'),{recursive:true});
 // No uncommitted unrelated feature work, credentials, runtime data or old QA exports.
 for(const path of ['audit','outputs','output','data','.env','.env.local','.env.production','.codex','.agents'])await rm(join(destination,path),{recursive:true,force:true});
 await symlink(join(root,'node_modules'),join(destination,'node_modules'),'dir');
 if(product==='aipm') {
   await edit(join(destination,'server/index.ts'),"import { analyticsRouter", "import { unionMembershipRouter } from './union-membership.js';\nimport { analyticsRouter");
   await edit(join(destination,'server/index.ts'),'app.use(loadAdmin);',"app.use(loadAdmin);\napp.use(unionMembershipRouter);");
   // The local debug directory was never part of the published app.
   await edit(join(destination,'tsconfig.app.json'),'"include": ["src"]','"include": ["src"],\n  "exclude": ["src/local-debug"]');
   for(const name of ['app','node'])await edit(join(destination,`tsconfig.${name}.json`),`./node_modules/.tmp/tsconfig.${name}.tsbuildinfo`,`./.union-cache/tsconfig.${name}.tsbuildinfo`);
 }
 if(product!=='keban') {
   const configFile=product==='aipm'?'vite.config.ts':'vite.config.js';
   const p=join(destination,configFile);const content=await readFile(p,'utf8');
   if(content.includes('defineConfig({'))await writeFile(p,content.replace('defineConfig({',"defineConfig({\n  cacheDir: '.union-vite-cache',"));
 }
 if(product==='workflow')await edit(join(destination,'server/index.mjs'),'app.listen(port, () =>',"app.listen(port, '127.0.0.1', () =>");
 if(product==='pattern')await edit(join(destination,'server/index.js'),'app.listen(PORT, () =>',"app.listen(PORT, '127.0.0.1', () =>");
 manifest.sources[product]={head:run('git',['-C',root,'rev-parse','HEAD']),reviewedPaths:reviewed[product]};
}
const key=()=>randomBytes(32).toString('hex');
await writeFile(join(base,'private-config.json'),JSON.stringify({identityToken:key(),productTokens:Object.fromEntries(Object.keys(roots).map(p=>[p,key()])),authSecrets:Object.fromEntries(Object.keys(roots).map(p=>[p,key()])),salt:key(),adminToken:key()},null,2),{mode:0o600});
await writeFile(join(base,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Local reviewed source copies prepared: ${base}`);
