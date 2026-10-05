const { Client } = require('pg');

const pgUrl = process.env.DATABASE_URL || 'postgresql://postgres:GammaPos2026@127.0.0.1:5432/recreopay_db';

async function runAudit() {
  const client = new Client({ connectionString: pgUrl });
  await client.connect();
  console.log('✅ Conectado a PostgreSQL:', pgUrl);

  // 1. Obtener todas las tablas en public
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  console.log('\n--- 1. AUDITORÍA DE COLUMNAS Y VALORES NULL EN TODAS LAS TABLAS ---');
  for (const row of tablesRes.rows) {
    const table = row.table_name;
    const countRes = await client.query(`SELECT COUNT(*) as total FROM "${table}"`);
    const total = parseInt(countRes.rows[0].total, 10);
    console.log(`\n📋 Tabla: ${table} (Total registros: ${total})`);

    const colsRes = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position;
    `, [table]);

    if (total > 0) {
      for (const col of colsRes.rows) {
        const nullCountRes = await client.query(`
          SELECT COUNT(*) as null_count 
          FROM "${table}" 
          WHERE "${col.column_name}" IS NULL OR "${col.column_name}"::text = '';
        `);
        const nullCount = parseInt(nullCountRes.rows[0].null_count, 10);
        if (nullCount > 0) {
          console.log(`   ⚠️ Columna "${col.column_name}" (${col.data_type}): ${nullCount}/${total} registros son NULL o vacíos`);
        }
      }
    } else {
      console.log('   (Tabla vacía)');
    }
  }

  // 2. Diagnóstico específico y corrección en orden_detalles
  console.log('\n--- 2. DETALLE DE ORDEN_DETALLES ---');
  const detRes = await client.query(`
    SELECT d.id, d.orden_id, d.producto_id, d.nombre_producto, p.nombre as prod_actual_nombre
    FROM orden_detalles d
    LEFT JOIN productos p ON d.producto_id = p.id
    ORDER BY d.id ASC;
  `);
  console.log(`Total detalles: ${detRes.rows.length}`);
  const sinNombre = detRes.rows.filter(r => !r.nombre_producto || r.nombre_producto.trim() === '');
  console.log(`Detalles con nombre_producto NULL o vacío: ${sinNombre.length}`);

  if (sinNombre.length > 0) {
    console.log('\n🔧 Corrigiendo nombre_producto en orden_detalles desde la tabla productos...');
    const updateRes = await client.query(`
      UPDATE orden_detalles d
      SET nombre_producto = COALESCE(p.nombre, 'Producto #' || d.producto_id::text)
      FROM productos p
      WHERE d.producto_id = p.id AND (d.nombre_producto IS NULL OR TRIM(d.nombre_producto) = '');
    `);
    console.log(`✅ Registros actualizados en orden_detalles: ${updateRes.rowCount}`);

    // Verificar si quedó alguno huérfano sin producto vinculado
    const huerfanos = await client.query(`
      UPDATE orden_detalles
      SET nombre_producto = 'Producto #' || producto_id::text
      WHERE (nombre_producto IS NULL OR TRIM(nombre_producto) = '');
    `);
    if (huerfanos.rowCount > 0) {
      console.log(`✅ Registros huérfanos nombrados por ID: ${huerfanos.rowCount}`);
    }
  }

  // 3. Revisar la tabla transacciones (si existe y qué contiene)
  console.log('\n--- 3. REVISIÓN DE TABLAS ADICIONALES ---');
  try {
    const tCount = await client.query(`SELECT COUNT(*) as c FROM transacciones`);
    console.log(`Registros en tabla "transacciones": ${tCount.rows[0].c}`);
  } catch (e) {
    console.log('Tabla "transacciones" no accesible o error:', e.message);
  }

  // 4. Verificación final de orden_detalles
  const verifyRes = await client.query(`
    SELECT id, orden_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal
    FROM orden_detalles
    ORDER BY id ASC
    LIMIT 10;
  `);
  console.log('\n--- 4. MUESTRA DE ORDEN_DETALLES POST-CORRECCIÓN ---');
  console.table(verifyRes.rows);

  await client.end();
  console.log('\n🏁 Auditoría y corrección finalizada con éxito.');
}

runAudit().catch(err => {
  console.error('❌ Error en auditoría:', err);
  process.exit(1);
});
