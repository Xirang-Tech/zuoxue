import { readFile, writeFile } from 'node:fs/promises';

// Only reviewed entry/SSO edits; never copy a whole dirty worktree or touch its deployment files.
const roots = {
  keban: '/Users/t7/Documents/Codex/workspace/ai-course-copilot-fresh',
  aipm: '/Users/t7/Documents/ChatGPT/AIPM2/ai-pm-workbench',
  workflow: '/Users/t7/Documents/工作流/VibeWorkflow',
};
const write = process.argv.includes('--write');
const widget = await readFile(new URL('../public/widget.js',import.meta.url),'utf8');
const oldPrice = "      const price = text('div',Number.isSafeInteger(plan?.priceCents) ? `¥${(plan.priceCents / 100).toFixed(2)}` : '价格待公布'); price.className = 'price'; price.append(text('small',Number.isSafeInteger(plan?.priceCents) ? '/ 月卡整单 · 一次性购买' : '审核完成后开放购买')); top.append(price);";
const newPrice = widget.split('\n').filter(line=>line.includes('const displayPrice =') || line.includes("const price = text('div'")).join('\n');
const edits = Object.entries(roots).map(([product,root]) => ({path:`${root}/${product === 'workflow' ? 'src/lib/union-widget.js' : 'src/components/union/widget.js'}`,old:oldPrice,replacement:newPrice}));
edits.push({path:`${roots.aipm}/src/lib/sso.ts`,old:"const IDENTITY_ORIGIN = 'https://auth.zuoxue.com';",replacement:"const IDENTITY_ORIGIN = new URL(import.meta.env.VITE_IDENTITY_PUBLIC_ORIGIN || 'https://auth.zuoxue.com').origin;"});
edits.push({path:`${roots.keban}/src/app/api/union-membership/events/route.ts`,old:'import { authErrorResponse, requireUserRecord }',replacement:'import { buildPublicAppUrl } from "@/lib/server/app-public-origin";\nimport { authErrorResponse, requireUserRecord }'});
edits.push({path:`${roots.keban}/src/app/api/union-membership/events/route.ts`,old:'new URL(request.url).origin',replacement:'new URL(buildPublicAppUrl("/", request)).origin'});
edits.push({path:`${roots.aipm}/src/components/union/UnionMembershipOffer.tsx`,old:"export function UnionMembershipOffer({ placement = 'paywall' }: { placement?: 'paywall' | 'account' })",replacement:"export function UnionMembershipOffer({ placement = 'paywall', returnUrl }: { placement?: 'paywall' | 'account'; returnUrl?: string })"});
edits.push({path:`${roots.aipm}/src/components/union/UnionMembershipOffer.tsx`,old:"{ productId: 'aipm', placement });",replacement:"{ productId: 'aipm', placement, returnUrl });"});
edits.push({path:`${roots.aipm}/src/components/union/UnionMembershipOffer.tsx`,old:'}, [placement]);',replacement:'}, [placement, returnUrl]);'});
edits.push({path:`${roots.aipm}/src/pages/BillingPage.tsx`,old:'  const pct = me.grant > 0',replacement:"  const unionReturnTarget = owner && returnTask ? resolveBillingReturn(returnTask, owner, useStore.getState().plans) : null;\n  const unionReturnUrl = unionReturnTarget?.page === 'project' && unionReturnTarget.param\n    ? new URL(`#project/${unionReturnTarget.param}`, window.location.href).href : undefined;\n  const pct = me.grant > 0"});
edits.push({path:`${roots.aipm}/src/pages/BillingPage.tsx`,old:'      <UnionMembershipOffer />',replacement:'      <UnionMembershipOffer returnUrl={unionReturnUrl} />'});
edits.push({path:`${roots.aipm}/src/App.tsx`,old:'<UnionMembershipOffer placement="account" />',replacement:'<UnionMembershipOffer placement="account" returnUrl={new URL(param ? `#${page}/${param}` : `#${page}`, location.href).href} />'});
for (const edit of edits) {
  const before = await readFile(edit.path,'utf8');
  if (before.includes(edit.replacement)) { console.log(`unchanged ${edit.path}`); continue; }
  if (before.split(edit.old).length !== 2) throw new Error(`Entry changed concurrently; review before editing: ${edit.path}`);
  const after = before.replace(edit.old,edit.replacement);
  if (write) await writeFile(edit.path,after);
  console.log(`${write ? 'updated' : 'would update'} ${edit.path}`);
}
for(const path of [`${roots.aipm}/.env.example`,`${roots.aipm}/deploy/.env.example`]) {
  const before=await readFile(path,'utf8');
  if(/^VITE_IDENTITY_PUBLIC_ORIGIN=/m.test(before))continue;
  if(write)await writeFile(path,before+'\n# Public, build-time SSO origin; testing uses https://dev-auth.zuoxue.com\nVITE_IDENTITY_PUBLIC_ORIGIN=https://auth.zuoxue.com\n');
  console.log(`${write?'updated':'would update'} ${path}`);
}
