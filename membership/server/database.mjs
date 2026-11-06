import pg from 'pg';

export class Database {
  constructor(connectionString) { this.pool = new pg.Pool({ connectionString, max: 10 }); }
  query(text, values) { return this.pool.query(text, values); }
  async transaction(work) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  close() { return this.pool.end(); }
}
