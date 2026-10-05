const { Client } = require('pg');

async function clean() {
  const client = new Client({ connectionString: 'postgresql://postgres:GammaPos2026@127.0.0.1:5432/recreopay_db' });
  await client.connect();
  await client.query("DELETE FROM transacciones_saldo WHERE descripcion LIKE '%test PIN correcto%'");
  await client.query('UPDATE estudiantes SET saldo_colones = 4500 WHERE id = 2');
  await client.query('UPDATE estudiantes SET saldo_colones = 1500 WHERE id = 1');
  const res = await client.query('SELECT id, nombre_completo, saldo_colones FROM estudiantes WHERE id IN (1, 2) ORDER BY id');
  console.log('SALDOS RESTAURADOS:', res.rows);
  await client.end();
}

clean().catch(console.error);
