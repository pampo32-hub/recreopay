const Database = require('better-sqlite3');
const { Client } = require('pg');
const path = require('path');

const sqlitePath = path.join(__dirname, '..', 'server', 'recreopay.db');
const dbSqlite = new Database(sqlitePath);

const pgUrl = process.env.DATABASE_URL || 'postgresql://postgres:GammaPos2026@127.0.0.1:5432/recreopay_db';
const client = new Client({ connectionString: pgUrl });

async function migrate() {
  console.log('🚀 Conectando a PostgreSQL:', pgUrl);
  await client.connect();

  const tables = [
    { name: 'usuarios', cols: ['id', 'username', 'password_hash', 'rol', 'nombre', 'telefono', 'email', 'activo', 'creado_en'] },
    { name: 'estudiantes', cols: ['id', 'usuario_id', 'codigo_estudiante', 'nombre_completo', 'edad', 'grado', 'seccion', 'qr_token', 'pin_seguridad', 'foto_url', 'saldo_colones', 'limite_diario_colones', 'alergias', 'bloquear_chucherias', 'tarjeta_bloqueada', 'padre_nombre', 'padre_telefono', 'padre_usuario_id', 'permitir_transferencias', 'activo', 'creado_en'] },
    { name: 'categorias', cols: ['id', 'nombre', 'icono', 'orden'] },
    { name: 'productos', cols: ['id', 'categoria_id', 'nombre', 'descripcion', 'precio_colones', 'imagen_url', 'stock', 'es_saludable', 'contiene_alergenos', 'disponible', 'icono', 'calorias', 'cumple_mep', 'alergenos', 'permite_preorden', 'destacado', 'control_stock', 'creado_en'] },
    { name: 'disenos_tarjetas', cols: ['id', 'theme_id', 'nombre', 'categoria', 'imagen_url', 'estilo_texto', 'es_predeterminado', 'activo', 'creado_en'] },
    { name: 'ordenes', cols: ['id', 'codigo_orden', 'estudiante_id', 'tipo_orden', 'momento_entrega', 'estado', 'total_colones', 'notas', 'creado_en', 'entregado_en', 'cajero_id', 'saldo_anterior', 'saldo_posterior', 'metodo_pago', 'observaciones'] },
    { name: 'orden_detalles', cols: ['id', 'orden_id', 'producto_id', 'cantidad', 'precio_unitario', 'subtotal', 'nombre_producto'] },
    { name: 'transacciones_saldo', cols: ['id', 'estudiante_id', 'tipo', 'monto_colones', 'saldo_previo', 'saldo_posterior', 'comprobante_sinpe', 'orden_id', 'descripcion', 'revertida', 'revertido_por_usuario_id', 'revertido_en', 'fecha'] },
    { name: 'padres_estudiantes', cols: ['id', 'padre_usuario_id', 'estudiante_id', 'creado_en'] },
    { name: 'notificaciones', cols: ['id', 'usuario_id', 'estudiante_id', 'titulo', 'mensaje', 'tipo', 'leida', 'creado_en'] }
  ];

  for (const t of tables) {
    try {
      // Check if table exists in SQLite
      const existsInSqlite = dbSqlite.prepare(`SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name=?`).get(t.name);
      if (!existsInSqlite || existsInSqlite.c === 0) {
        console.log(`⚠️ Tabla "${t.name}" no encontrada en SQLite, omitiendo.`);
        continue;
      }

      // Check which columns exist in SQLite
      const tableInfo = dbSqlite.prepare(`PRAGMA table_info(${t.name})`).all();
      const sqliteCols = tableInfo.map(c => c.name);
      const availableCols = t.cols.filter(c => sqliteCols.includes(c));

      const rows = dbSqlite.prepare(`SELECT ${availableCols.join(', ')} FROM ${t.name}`).all();
      console.log(`📦 Migrando ${rows.length} registros para la tabla "${t.name}"...`);

      for (const row of rows) {
        const colsList = availableCols.join(', ');
        const placeholders = availableCols.map((_, idx) => `$${idx + 1}`).join(', ');
        const values = availableCols.map(c => row[c]);

        const insertSql = `
          INSERT INTO ${t.name} (${colsList})
          VALUES (${placeholders})
          ON CONFLICT (id) DO NOTHING;
        `;
        await client.query(insertSql, values);
      }

      // Sync sequence
      await client.query(`SELECT setval(pg_get_serial_sequence('${t.name}', 'id'), COALESCE((SELECT MAX(id) FROM ${t.name}), 1));`);
      console.log(`✅ Tabla "${t.name}" migrada y secuencia actualizada.`);
    } catch (err) {
      console.error(`❌ Error en tabla "${t.name}":`, err.message);
    }
  }

  console.log('\n🎉 ¡Migración de datos a PostgreSQL completada con éxito!');
  await client.end();
}

migrate().catch(e => {
  console.error('Fatal error en migración:', e);
  process.exit(1);
});
