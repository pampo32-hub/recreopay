const { Client } = require('pg');

const pgUrl = process.env.DATABASE_URL || 'postgresql://sibopay_user:SiboPay_Postgres_2026_SecureKey!@127.0.0.1:5432/sibopay_db';

async function deepAudit() {
  const client = new Client({ connectionString: pgUrl });
  await client.connect();

  console.log('🔍 INICIANDO AUDITORÍA PROFUNDA DE TODAS LAS TABLAS');

  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const report = {};

  for (const tRow of tablesRes.rows) {
    const table = tRow.table_name;
    const countRes = await client.query(`SELECT COUNT(*) as total FROM "${table}"`);
    const total = parseInt(countRes.rows[0].total, 10);

    const colsRes = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position;
    `, [table]);

    report[table] = {
      total,
      columnsWithNulls: []
    };

    if (total > 0) {
      for (const col of colsRes.rows) {
        const nullRes = await client.query(`
          SELECT COUNT(*) as c 
          FROM "${table}" 
          WHERE "${col.column_name}" IS NULL;
        `);
        const nullCount = parseInt(nullRes.rows[0].c, 10);
        if (nullCount > 0) {
          report[table].columnsWithNulls.push({
            column: col.column_name,
            dataType: col.data_type,
            nullCount,
            total,
            percentage: ((nullCount / total) * 100).toFixed(1) + '%'
          });
        }
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await client.end();
}

deepAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
