import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Database } from '../server/database.mjs';
export async function migrate(db) {
  await db.query('CREATE TABLE IF NOT EXISTS union_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of (await readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = await readFile(`${dir}/${name}`, 'utf8');
    await db.transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(70419201)');
      if ((await tx.query('SELECT 1 FROM union_schema_migrations WHERE version=$1', [name])).rowCount) return;
      await tx.query(sql);
      await tx.query('INSERT INTO union_schema_migrations(version) VALUES($1)', [name]);
    });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('请配置独立的 DATABASE_URL');
  const db = new Database(process.env.DATABASE_URL);
  try { await migrate(db); process.stdout.write('会员数据库迁移完成\n'); } finally { await db.close(); }
}
