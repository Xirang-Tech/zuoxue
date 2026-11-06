import { spawnSync } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const base=fileURLToPath(new URL('../output/local-integration/',import.meta.url));
const data=join(base,'postgres'),bin='/opt/homebrew/opt/postgresql@16/bin/';
await mkdir(base,{recursive:true});
function run(name,args){const result=spawnSync(bin+name,args,{encoding:'utf8'});if(result.status!==0)throw new Error(`${name} failed: ${result.stderr||result.stdout||'PostgreSQL 16 not installed'}`);}
try {await stat(join(data,'PG_VERSION'));}catch(error){if(error.code!=='ENOENT')throw error;run('initdb',['-D',data,'-U','union_local','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--locale=C']);}
if(spawnSync(bin+'pg_ctl',['-D',data,'status'],{stdio:'ignore'}).status!==0)run('pg_ctl',['-D',data,'-l',join(base,'postgres.log'),'-o',`-h 127.0.0.1 -p 56473 -k "${base}"`,'-w','start']);
console.log('专用本地 PostgreSQL 已启动：127.0.0.1:56473，仅使用联合会员联调目录。');
