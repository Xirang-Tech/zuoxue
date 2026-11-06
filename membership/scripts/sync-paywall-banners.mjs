import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// Synchronize only the reviewed banner files; never replace a whole worktree.
const member = fileURLToPath(new URL('../', import.meta.url));
const roots = {
  keban: '/Users/t7/Documents/Codex/workspace/ai-course-copilot-fresh',
  aipm: '/Users/t7/Documents/ChatGPT/AIPM2/ai-pm-workbench',
  workflow: '/Users/t7/Documents/工作流/VibeWorkflow',
  pattern: join(member, '../worktrees/pattern-union'),
};
const write = process.argv.includes('--write');
const baseHash = '630d4449aa0846824c17b8d191c6dc8c12ef3381cfb08317ad3ef4a7b5a826cb';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const statePath = join(member,'output/banner-implementation/sync-state.json');
let state = {};
try { state = JSON.parse(await readFile(statePath,'utf8')); } catch (e) { if(e.code !== 'ENOENT') throw e; }
const widget = await readFile(join(member,'public/widget.js'));
const mediaRoot = join(member,'public/union-media');
const media = (await readdir(mediaRoot)).filter(name => /\.(svg|webp)$/.test(name));
const edits = [];
for (const [id, root] of Object.entries(roots)) {
  for (const [kind, destination] of [['original',root],['local',join(member,'output/local-integration/sources',id)]]) {
    if (id !== 'pattern') {
      const target=join(destination,id==='workflow'?'src/lib/union-widget.js':'src/components/union/widget.js');
      edits.push({id:`${id}-${kind}-widget`,target,content:widget,base:baseHash});
    } else if(kind==='local') {
      for(const relative of ['src/components/UnionMembershipOffer.jsx','src/styles.css']) {
        const content=await readFile(join(root,relative),'utf8');
        const previous=relative.endsWith('.css') ? content.split('\n/* The paywall banner is distinct')[0] : content.replace(/  if \(entryPlacement\(entry\) === 'paywall'\) \{[\s\S]*?(?=  const plans =)/,'');
        edits.push({id:`pattern-local-${relative.endsWith('.css')?'styles':'component'}`,target:join(destination,relative),content:Buffer.from(content),previous});
      }
    }
    for(const name of media) edits.push({id:`${id}-${kind}-${name}`,target:join(destination,'public/union-media',name),content:await readFile(join(mediaRoot,name)),asset:true});
  }
}
// Validate every precondition before writing any file.
for(const edit of edits) {
  try {edit.before=await readFile(edit.target);} catch(e) {if(e.code!=='ENOENT')throw e;}
  if(edit.before && !edit.asset && hash(edit.before)!==hash(edit.content) && hash(edit.before)!==edit.base && hash(edit.before)!==state[edit.id]?.writtenHash && (edit.previous===undefined || edit.before.toString().trimEnd()!==edit.previous.trimEnd())) throw new Error(`Banner changed concurrently; review before syncing: ${edit.target}`);
  if(edit.before && edit.asset && hash(edit.before)!==hash(edit.content) && hash(edit.before)!==state[edit.id]?.writtenHash) throw new Error(`Existing asset differs; review before syncing: ${edit.target}`);
}
for(const edit of edits) {
  if(edit.before && hash(edit.before)===hash(edit.content)) continue;
  if(write) {
    const backup=join(member,'output/banner-implementation/backups',edit.id);
    if(!state[edit.id]) {
      if(edit.before) {await mkdir(dirname(backup),{recursive:true});await writeFile(backup,edit.before);}
      state[edit.id]={target:edit.target,backup:edit.before?backup:null};
    }
    await mkdir(dirname(edit.target),{recursive:true});
    await writeFile(edit.target,edit.content);
    state[edit.id].writtenHash=hash(edit.content);
    await mkdir(dirname(statePath),{recursive:true});
    await writeFile(statePath,JSON.stringify(state,null,2)+'\n');
  }
}
console.log(JSON.stringify({mode:write?'write':'dry-run',reviewedFiles:edits.length,changedFiles:edits.filter(edit=>!edit.before||hash(edit.before)!==hash(edit.content)).length}));
// Keep the reviewed local-export manifest explicit without recreating sources.
if(write) {
  const manifestPath=join(member,'output/local-integration/manifest.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  manifest.bannerAssets={source:'membership/public/union-media',files:media};
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
}
