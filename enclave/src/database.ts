// Database Layer for TEE Enclave
//
// Replaces in-memory signup counter with Postgres-backed persistence.
// Connects to Postgres primary over dstack VPN. Can fall back to replica for reads.
//
// Tables: signups, audit_log, user_data_receipts, reports

import { Pool, PoolConfig } from 'pg';

let pool: Pool;
let replicaPool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

export function getReplicaPool(): Pool {
  return replicaPool || getPool();
}

export async function initDatabase(): Promise<void> {
  const primaryUrl = process.env.DATABASE_URL;
  if (!primaryUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const poolConfig: PoolConfig = {
    connectionString: primaryUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  pool = new Pool(poolConfig);

  // Optional replica for read fallback
  const replicaUrl = process.env.DATABASE_REPLICA_URL;
  if (replicaUrl) {
    replicaPool = new Pool({
      connectionString: replicaUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  await runMigrations();
}

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS signups (
        id SERIAL PRIMARY KEY,
        user_id_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source_cvm TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}',
        signature TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_data_receipts (
        receipt_id TEXT PRIMARY KEY,
        user_id_hash TEXT NOT NULL,
        safe_derivative TEXT NOT NULL,
        signature TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        deletion_tx_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS reports (
        report_id TEXT PRIMARY KEY,
        time_window_start TIMESTAMPTZ NOT NULL,
        time_window_end TIMESTAMPTZ NOT NULL,
        report_json JSONB NOT NULL,
        signature TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('[Database] Migrations complete');
  } finally {
    client.release();
  }
}

// --- Signup operations ---

export async function insertSignup(userIdHash: string, sourceCvm?: string): Promise<number> {
  const result = await pool.query(
    'INSERT INTO signups (user_id_hash, source_cvm) VALUES ($1, $2) RETURNING id',
    [userIdHash, sourceCvm || null]
  );
  return result.rows[0].id;
}

export async function getSignupCount(): Promise<number> {
  const result = await getReplicaPool().query('SELECT COUNT(*)::int AS count FROM signups');
  return result.rows[0].count;
}

// --- Audit log operations ---

export async function insertAuditEntry(
  action: string,
  details: Record<string, unknown>,
  signature?: string
): Promise<number> {
  const result = await pool.query(
    'INSERT INTO audit_log (action, details, signature) VALUES ($1, $2, $3) RETURNING id',
    [action, JSON.stringify(details), signature || null]
  );
  return result.rows[0].id;
}

export async function getAuditLog(since?: Date): Promise<Array<{
  id: number;
  action: string;
  details: Record<string, unknown>;
  signature: string | null;
  created_at: Date;
}>> {
  const query = since
    ? 'SELECT * FROM audit_log WHERE created_at >= $1 ORDER BY created_at ASC'
    : 'SELECT * FROM audit_log ORDER BY created_at ASC';
  const params = since ? [since] : [];
  const result = await getReplicaPool().query(query, params);
  return result.rows;
}

// --- User data receipt operations ---

export async function insertReceipt(
  receiptId: string,
  userIdHash: string,
  safeDerivative: string,
  signature: string
): Promise<void> {
  await pool.query(
    `INSERT INTO user_data_receipts (receipt_id, user_id_hash, safe_derivative, signature, deleted_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [receiptId, userIdHash, safeDerivative, signature]
  );
}

export async function setDeletionTxHash(receiptId: string, txHash: string): Promise<void> {
  await pool.query(
    'UPDATE user_data_receipts SET deletion_tx_hash = $1 WHERE receipt_id = $2',
    [txHash, receiptId]
  );
}

export async function getReceiptCount(since?: Date): Promise<number> {
  const query = since
    ? 'SELECT COUNT(*)::int AS count FROM user_data_receipts WHERE created_at >= $1'
    : 'SELECT COUNT(*)::int AS count FROM user_data_receipts';
  const params = since ? [since] : [];
  const result = await getReplicaPool().query(query, params);
  return result.rows[0].count;
}

// --- Report operations ---

export async function insertReport(
  reportId: string,
  timeWindowStart: Date,
  timeWindowEnd: Date,
  reportJson: Record<string, unknown>,
  signature: string
): Promise<void> {
  await pool.query(
    `INSERT INTO reports (report_id, time_window_start, time_window_end, report_json, signature)
     VALUES ($1, $2, $3, $4, $5)`,
    [reportId, timeWindowStart, timeWindowEnd, JSON.stringify(reportJson), signature]
  );
}

export async function getReports(): Promise<Array<{
  report_id: string;
  report_json: Record<string, unknown>;
  signature: string;
  created_at: Date;
}>> {
  const result = await getReplicaPool().query(
    'SELECT report_id, report_json, signature, created_at FROM reports ORDER BY created_at DESC'
  );
  return result.rows;
}

export async function closeDatabase(): Promise<void> {
  if (pool) await pool.end();
  if (replicaPool) await replicaPool.end();
}
