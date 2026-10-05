const { Client } = require('pg');

const pgUrl = process.env.DATABASE_URL || 'postgresql://postgres:GammaPos2026@127.0.0.1:5432/recreopay_db';

async function fixAllNulls() {
  const client = new Client({ connectionString: pgUrl });
  await client.connect();
  console.log('🚀 Conectado a PostgreSQL para corrección integral de NULLs.');

  // ==========================================
  // 1. CORREGIR TABLA "ordenes"
  // ==========================================
  console.log('\n--- 1. CORRIGIENDO TABLA "ordenes" ---');

  // 1.1 Códigos de orden para órdenes 1 a 9
  await client.query(`
    UPDATE ordenes
    SET codigo_orden = 'ORD-' || LPAD((id + 1000)::text, 4, '0')
    WHERE codigo_orden IS NULL OR TRIM(codigo_orden) = '';
  `);

  // 1.2 Tipo de orden derivado de transacciones_saldo o por defecto 'mostrador'
  await client.query(`
    UPDATE ordenes o
    SET tipo_orden = CASE 
      WHEN t.tipo = 'preorden' THEN 'preorden'
      ELSE 'mostrador'
    END
    FROM transacciones_saldo t
    WHERE t.orden_id = o.id AND (o.tipo_orden IS NULL OR TRIM(o.tipo_orden) = '');
  `);
  await client.query(`
    UPDATE ordenes 
    SET tipo_orden = 'mostrador' 
    WHERE tipo_orden IS NULL OR TRIM(tipo_orden) = '';
  `);

  // 1.3 Momento de entrega
  await client.query(`
    UPDATE ordenes
    SET momento_entrega = CASE 
      WHEN tipo_orden = 'preorden' THEN 'recreo_1'
      ELSE 'inmediato'
    END
    WHERE momento_entrega IS NULL OR TRIM(momento_entrega) = '';
  `);

  // 1.4 Entregado en (si el estado es entregado pero la fecha está en null)
  await client.query(`
    UPDATE ordenes
    SET entregado_en = creado_en
    WHERE estado = 'entregado' AND entregado_en IS NULL;
  `);

  // 1.5 Saldo anterior y posterior desde transacciones_saldo
  await client.query(`
    UPDATE ordenes o
    SET saldo_anterior = t.saldo_previo,
        saldo_posterior = t.saldo_posterior
    FROM transacciones_saldo t
    WHERE t.orden_id = o.id AND (o.saldo_anterior IS NULL OR o.saldo_posterior IS NULL);
  `);

  // Para órdenes huérfanas sin fila en transacciones_saldo (ej: orden 12)
  await client.query(`
    UPDATE ordenes o
    SET saldo_anterior = COALESCE(o.saldo_anterior, (SELECT saldo_colones + o.total_colones FROM estudiantes WHERE id = o.estudiante_id)),
        saldo_posterior = COALESCE(o.saldo_posterior, (SELECT saldo_colones FROM estudiantes WHERE id = o.estudiante_id))
    WHERE o.saldo_anterior IS NULL OR o.saldo_posterior IS NULL;
  `);

  // 1.6 Cajero ID (asignar cajero usuario #6 'cajero' de la soda)
  await client.query(`
    UPDATE ordenes
    SET cajero_id = 6
    WHERE cajero_id IS NULL;
  `);

  // 1.7 Observaciones y Notas
  await client.query(`
    UPDATE ordenes
    SET observaciones = CASE 
      WHEN estado = 'anulada' THEN 'Orden revertida en administración'
      WHEN tipo_orden = 'preorden' THEN 'Pre-orden despachada en soda'
      ELSE 'Venta realizada en mostrador'
    END
    WHERE observaciones IS NULL OR TRIM(observaciones) = '';
  `);

  await client.query(`
    UPDATE ordenes
    SET notas = ''
    WHERE notas IS NULL;
  `);

  await client.query(`
    UPDATE ordenes
    SET metodo_pago = 'monedero_qr'
    WHERE metodo_pago IS NULL OR TRIM(metodo_pago) = '';
  `);

  console.log('✅ Tabla "ordenes" corregida.');

  // ==========================================
  // 2. CORREGIR TABLA "productos"
  // ==========================================
  console.log('\n--- 2. CORRIGIENDO TABLA "productos" ---');

  await client.query(`
    UPDATE productos
    SET imagen_url = '',
        contiene_alergenos = 'No',
        alergenos = 'Ninguno conocido',
        calorias = 220,
        descripcion = COALESCE(NULLIF(TRIM(descripcion), ''), 'Alimento preparado en soda escolar')
    WHERE imagen_url IS NULL 
       OR contiene_alergenos IS NULL 
       OR alergenos IS NULL 
       OR calorias IS NULL;
  `);

  console.log('✅ Tabla "productos" corregida.');

  // ==========================================
  // 3. CORREGIR TABLA "estudiantes"
  // ==========================================
  console.log('\n--- 3. CORRIGIENDO TABLA "estudiantes" ---');

  // Crear usuarios de estudiantes faltantes si no existen
  const nuevosUsuarios = [
    { username: 'lucia', nombre: 'Lucía Fernández Solís', rol: 'estudiante' },
    { username: 'nacho', nombre: 'Ignacio Vargas Chaves', rol: 'estudiante' },
    { username: 'vale', nombre: 'Valentina Rojas Quesada', rol: 'estudiante' },
    { username: 'elena_madre', nombre: 'Elena Solís (Mamá)', rol: 'padre' },
    { username: 'roberto_padre', nombre: 'Roberto Vargas (Papá)', rol: 'padre' },
    { username: 'patricia_madre', nombre: 'Patricia Quesada (Mamá)', rol: 'padre' }
  ];

  for (const u of nuevosUsuarios) {
    await client.query(`
      INSERT INTO usuarios (username, password_hash, rol, nombre, activo)
      VALUES ($1, '1234', $2, $3, 1)
      ON CONFLICT (username) DO NOTHING;
    `, [u.username, u.rol, u.nombre]);
  }

  // Vincular usuario_id y padre_usuario_id
  await client.query(`
    UPDATE estudiantes SET 
      usuario_id = (SELECT id FROM usuarios WHERE username = 'lucia'),
      padre_usuario_id = (SELECT id FROM usuarios WHERE username = 'elena_madre')
    WHERE id = 3;

    UPDATE estudiantes SET 
      usuario_id = (SELECT id FROM usuarios WHERE username = 'nacho'),
      padre_usuario_id = (SELECT id FROM usuarios WHERE username = 'roberto_padre')
    WHERE id = 4;

    UPDATE estudiantes SET 
      usuario_id = (SELECT id FROM usuarios WHERE username = 'vale'),
      padre_usuario_id = (SELECT id FROM usuarios WHERE username = 'patricia_madre')
    WHERE id = 5;
  `);

  // Asegurar padres_estudiantes
  await client.query(`
    INSERT INTO padres_estudiantes (padre_usuario_id, estudiante_id)
    SELECT padre_usuario_id, id FROM estudiantes 
    WHERE padre_usuario_id IS NOT NULL
    ON CONFLICT (padre_usuario_id, estudiante_id) DO NOTHING;
  `);

  await client.query(`
    UPDATE usuarios 
    SET telefono = COALESCE(telefono, ''),
        email = COALESCE(email, '')
    WHERE telefono IS NULL OR email IS NULL;
  `);

  console.log('✅ Tabla "estudiantes" y "usuarios" corregidas.');

  // ==========================================
  // 4. CORREGIR TABLA "transacciones_saldo"
  // ==========================================
  console.log('\n--- 4. CORRIGIENDO TABLA "transacciones_saldo" ---');

  // Llenar comprobante_sinpe para no dejar NULLs
  await client.query(`
    UPDATE transacciones_saldo
    SET comprobante_sinpe = 'N/A'
    WHERE comprobante_sinpe IS NULL OR TRIM(comprobante_sinpe) = '';
  `);

  console.log('✅ Tabla "transacciones_saldo" corregida.');

  // ==========================================
  // 5. AUDITORÍA FINAL POST-CORRECCIÓN
  // ==========================================
  console.log('\n--- 5. AUDITORÍA FINAL COMPROBATORIA ---');

  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const auditResult = {};
  for (const tRow of tablesRes.rows) {
    const table = tRow.table_name;
    const countRes = await client.query(`SELECT COUNT(*) as total FROM "${table}"`);
    const total = parseInt(countRes.rows[0].total, 10);

    const colsRes = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position;
    `, [table]);

    auditResult[table] = {
      total,
      nullColumns: []
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
          auditResult[table].nullColumns.push({
            column: col.column_name,
            nullCount,
            total
          });
        }
      }
    }
  }

  console.log(JSON.stringify(auditResult, null, 2));

  await client.end();
  console.log('\n🎉 Proceso completado exitosamente.');
}

fixAllNulls().catch(e => {
  console.error(e);
  process.exit(1);
});
