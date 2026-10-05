const { runAsWorker } = require('synckit');
const { Pool, types } = require('pg');

// Mapear tipos numéricos de PostgreSQL a Number en JavaScript
types.setTypeParser(20, (val) => val === null ? null : parseInt(val, 10)); // int8 / bigint
types.setTypeParser(21, (val) => val === null ? null : parseInt(val, 10)); // int2 / smallint
types.setTypeParser(23, (val) => val === null ? null : parseInt(val, 10)); // int4 / integer
types.setTypeParser(1700, (val) => val === null ? null : parseFloat(val)); // numeric / decimal
types.setTypeParser(700, (val) => val === null ? null : parseFloat(val));  // float4 / real
types.setTypeParser(701, (val) => val === null ? null : parseFloat(val));  // float8 / double precision

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:GammaPos2026@127.0.0.1:5432/recreopay_db';

const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('⚠️ Error en pool PostgreSQL:', err.message);
});

runAsWorker(async ({ sql, params }) => {
  try {
    const res = await pool.query(sql, params || []);
    return {
      rows: res.rows || [],
      rowCount: res.rowCount || 0
    };
  } catch (err) {
    throw new Error(err.message);
  }
});
