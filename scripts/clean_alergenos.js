const { Client } = require('pg');
const pgUrl = process.env.DATABASE_URL || 'postgresql://postgres:GammaPos2026@127.0.0.1:5432/recreopay_db';

async function run() {
  const client = new Client({ connectionString: pgUrl });
  await client.connect();
  const res = await client.query("UPDATE productos SET alergenos = NULL WHERE alergenos ILIKE '%ninguno%' OR alergenos ILIKE '%no%' OR TRIM(alergenos) = '';");
  console.log(`✅ Alérgenos limpiados: ${res.rowCount} filas actualizadas a NULL.`);
  await client.end();
}

run().catch(console.error);
