const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'agencyzoom_dashboard',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD || '',
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

/**
 * Get a cached value if it exists and hasn't expired.
 * @param {string} key
 * @returns {object|null}
 */
async function cacheGet(key) {
  const { rows } = await pool.query(
    `SELECT data FROM az_cache
     WHERE key = $1 AND expires_at > NOW()`,
    [key]
  );
  return rows.length ? rows[0].data : null;
}

/**
 * Store a value in the cache.
 * @param {string} key
 * @param {object} data
 * @param {number} ttlSeconds
 */
async function cacheSet(key, data, ttlSeconds = 300) {
  await pool.query(
    `INSERT INTO az_cache (key, data, fetched_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + ($3 || ' seconds')::INTERVAL)
     ON CONFLICT (key) DO UPDATE
       SET data = EXCLUDED.data,
           fetched_at = EXCLUDED.fetched_at,
           expires_at = EXCLUDED.expires_at`,
    [key, JSON.stringify(data), ttlSeconds]
  );
}

/** Purge expired cache rows (call periodically). */
async function cachePurge() {
  await pool.query(`DELETE FROM az_cache WHERE expires_at <= NOW()`);
}

module.exports = { pool, cacheGet, cacheSet, cachePurge };
