const path = require('path');
const fs = require('fs');
const { normalizarCodigoDetalle } = require('./sinpeParser');

try {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
} catch (e) {}

let db;
const isPg = Boolean(process.env.DATABASE_URL);

if (isPg) {
  const { createSyncFn } = require('synckit');
  const syncQuery = createSyncFn(require.resolve('./pg-worker.js'));

  function convertSqlToPg(sql) {
    if (!sql || typeof sql !== 'string') return sql;
    let idx = 0;
    let s = sql.replace(/\?/g, () => `$${++idx}`);
    
    if (/^\s*PRAGMA/i.test(s)) return null;

    s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
    if (/INSERT\s+INTO/i.test(s) && !/ON\s+CONFLICT/i.test(s) && /OR\s+IGNORE/i.test(sql)) {
      s += ' ON CONFLICT DO NOTHING';
    }

    s = s.replace(/datetime\s*\(\s*['"]now['"][^)]*\)/gi, 'CURRENT_TIMESTAMP');
    s = s.replace(/strftime\s*\(\s*['"]%s['"]\s*,\s*['"]now['"]\s*\)/gi, 'EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)');
    s = s.replace(/strftime\s*\(\s*['"]%s['"]\s*,\s*([^)]+)\s*\)/gi, 'EXTRACT(EPOCH FROM $1)');
    s = s.replace(/date\s*\(\s*['"]now['"][^)]*\)/gi, 'CURRENT_DATE');
    s = s.replace(/date\s*\(\s*([^,)]+)(?:\s*,\s*['"]localtime['"])?\s*\)/gi, 'CAST($1 AS DATE)');

    // Compatibilidad SQLite -> PostgreSQL para funciones JSON
    s = s.replace(/json_group_array\s*\(/gi, 'json_agg(');
    s = s.replace(/json_object\s*\(/gi, 'json_build_object(');

    return s;
  }

  function normalizeParams(args) {
    let params = args;
    if (args.length === 1 && Array.isArray(args[0])) {
      params = args[0];
    }
    return params.map(p => (p === undefined ? null : p));
  }

  db = {
    isPg: true,
    prepare(sql) {
      const isInsert = /^\s*INSERT\s+INTO/i.test(sql);
      const hasReturning = /RETURNING/i.test(sql);
      let runSql = convertSqlToPg(sql);
      if (isInsert && !hasReturning) {
        runSql += ' RETURNING id';
      }

      return {
        all(...args) {
          const pgSql = convertSqlToPg(sql);
          if (!pgSql) return [];
          const res = syncQuery({ sql: pgSql, params: normalizeParams(args) });
          return res.rows;
        },
        get(...args) {
          const pgSql = convertSqlToPg(sql);
          if (!pgSql) return null;
          const res = syncQuery({ sql: pgSql, params: normalizeParams(args) });
          return res.rows[0] || null;
        },
        run(...args) {
          if (!runSql) return { changes: 0, lastInsertRowid: 0 };
          try {
            const res = syncQuery({ sql: runSql, params: normalizeParams(args) });
            const id = (res.rows && res.rows[0] && res.rows[0].id) ? Number(res.rows[0].id) : 0;
            return { changes: res.rowCount, lastInsertRowid: id };
          } catch (err) {
            const plainSql = convertSqlToPg(sql);
            const res = syncQuery({ sql: plainSql, params: normalizeParams(args) });
            return { changes: res.rowCount, lastInsertRowid: 0 };
          }
        }
      };
    },
    exec(sql) {
      const pgSql = convertSqlToPg(sql);
      if (pgSql) syncQuery({ sql: pgSql, params: [] });
    },
    pragma() {},
    transaction(fn) {
      return (...args) => fn(...args);
    }
  };
  console.log('🐘 Conectado a PostgreSQL central (recreopay_db)');
} else {
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, 'recreopay.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

function initDatabase() {
  if (isPg) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS escuelas (
          id SERIAL PRIMARY KEY,
          codigo VARCHAR(20) UNIQUE NOT NULL,
          nombre VARCHAR(150) NOT NULL,
          telefono_sinpe VARCHAR(30) DEFAULT '8888-8888',
          nombre_sinpe VARCHAR(150) DEFAULT 'Soda Central',
          concesionario VARCHAR(150),
          activo BOOLEAN DEFAULT TRUE,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) {}

    try {
      db.exec(`
        INSERT INTO escuelas (id, codigo, nombre, telefono_sinpe, nombre_sinpe, concesionario, activo)
        VALUES (1, 'ESC01', 'Soda Escolar Central', '8888-8888', 'Soda Central', 'Concesionario Central', true)
        ON CONFLICT (id) DO NOTHING;
      `);
    } catch (e) {}

    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS solicitudes_recarga_sinpe (
          id SERIAL PRIMARY KEY,
          estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
          padre_usuario_id INTEGER,
          monto_colones INTEGER NOT NULL,
          comprobante_sinpe TEXT NOT NULL,
          estado TEXT DEFAULT 'pendiente',
          notas TEXT,
          aprobado_por_usuario_id INTEGER,
          escuela_id INTEGER DEFAULT 1 REFERENCES escuelas(id),
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          procesado_en TIMESTAMP
        );
      `);
    } catch (e) {}

    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sinpe_transacciones_banco (
          id VARCHAR(100) PRIMARY KEY,
          reference_number VARCHAR(100),
          codigo_detalle VARCHAR(100),
          codigo_detalle_norm VARCHAR(100),
          amount_crc NUMERIC NOT NULL,
          sender_phone VARCHAR(50),
          sender_name VARCHAR(100),
          origin_bank VARCHAR(100),
          status VARCHAR(20) DEFAULT 'unclaimed',
          claimed_by_estudiante_id INTEGER,
          raw_data TEXT,
          received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          verified_at TIMESTAMP
        );
      `);
      try { db.exec('ALTER TABLE solicitudes_recarga_sinpe ADD COLUMN IF NOT EXISTS codigo_detalle VARCHAR(100);'); } catch (_) {}
    } catch (e) {}

    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id SERIAL PRIMARY KEY,
          endpoint TEXT UNIQUE NOT NULL,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          user_id INTEGER,
          rol VARCHAR(50),
          escuela_id INTEGER DEFAULT 1,
          creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (e) {
      console.error('Error creando push_subscriptions en PostgreSQL:', e);
    }
    try {
      db.exec('ALTER TABLE transacciones_saldo ADD COLUMN IF NOT EXISTS revertida INTEGER DEFAULT 0;');
      db.exec('ALTER TABLE transacciones_saldo ADD COLUMN IF NOT EXISTS revertido_por_usuario_id INTEGER REFERENCES usuarios(id);');
      db.exec('ALTER TABLE transacciones_saldo ADD COLUMN IF NOT EXISTS revertido_en TIMESTAMP;');
    } catch (e) {}

    seedUsuarios();
    seedDisenosTarjetas();
    migrarTrazabilidadSinpeRechazadas();
    return;
  }

  const schema = `
  -- 1. Usuarios del Sistema
  CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL, -- 'admin', 'cajero', 'padre', 'estudiante'
      nombre TEXT NOT NULL,
      telefono TEXT,
      email TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 2. Estudiantes
  CREATE TABLE IF NOT EXISTS estudiantes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER REFERENCES usuarios(id),
      codigo_estudiante TEXT UNIQUE NOT NULL,
      nombre_completo TEXT NOT NULL,
      edad INTEGER NOT NULL,
      grado TEXT NOT NULL,           -- Ej: "2° Grado", "8° Año"
      seccion TEXT NOT NULL,         -- Ej: "2-B", "8-1"
      qr_token TEXT UNIQUE NOT NULL, -- Token único para el QR
      pin_seguridad TEXT DEFAULT '1234',
      foto_url TEXT,
      saldo_colones INTEGER DEFAULT 0,
      limite_diario_colones INTEGER DEFAULT 3000,
      alergias TEXT,                 -- Ej: "Alérgico al maní, intolerante a lactosa"
      bloquear_chucherias INTEGER DEFAULT 0,
      padre_nombre TEXT,
      padre_telefono TEXT,
      permitir_transferencias INTEGER DEFAULT 1,
      activo INTEGER DEFAULT 1,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 3. Categorías de Alimentos
  CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      icono TEXT NOT NULL,
      orden INTEGER DEFAULT 0
  );

  -- 4. Productos
  CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria_id INTEGER REFERENCES categorias(id),
      nombre TEXT NOT NULL,
      descripcion TEXT,
      precio_colones INTEGER NOT NULL,
      imagen_url TEXT,
      icono TEXT,
      calorias INTEGER,
      cumple_mep INTEGER DEFAULT 1,      -- 1: Saludable MEP, 0: Ocasional
      alergenos TEXT,                   -- 'gluten, lactosa, maní'
      disponible INTEGER DEFAULT 1,
      permite_preorden INTEGER DEFAULT 1,
      destacado INTEGER DEFAULT 0
  );

  -- 5. Órdenes (Mostrador y Pre-órdenes)
  CREATE TABLE IF NOT EXISTS ordenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_orden TEXT UNIQUE NOT NULL, -- Ej: "ORD-1001"
      estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id),
      tipo_orden TEXT NOT NULL,          -- 'mostrador' o 'preorden'
      momento_entrega TEXT NOT NULL,     -- 'inmediato', 'recreo_1', 'almuerzo', 'recreo_2'
      estado TEXT DEFAULT 'pendiente',    -- 'pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado'
      total_colones INTEGER NOT NULL,
      notas TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      entregado_en DATETIME
  );

  -- 6. Detalles de Orden
  CREATE TABLE IF NOT EXISTS orden_detalles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_id INTEGER NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      nombre_producto TEXT,
      cantidad INTEGER NOT NULL,
      precio_unitario INTEGER NOT NULL,
      subtotal INTEGER NOT NULL
  );

  -- 7. Historial y Auditoría de Saldos (SINPE y Compras)
  CREATE TABLE IF NOT EXISTS transacciones_saldo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id),
      tipo TEXT NOT NULL,                -- 'recarga_sinpe', 'compra_mostrador', 'preorden', 'reembolso'
      monto_colones INTEGER NOT NULL,    -- Positivo recarga, negativo compra
      saldo_previo INTEGER NOT NULL,
      saldo_posterior INTEGER NOT NULL,
      comprobante_sinpe TEXT,
      orden_id INTEGER REFERENCES ordenes(id),
      descripcion TEXT,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  `;

  db.exec(schema);

  // Migraciones seguras para bases de datos existentes
  try { db.exec('ALTER TABLE estudiantes ADD COLUMN permitir_transferencias INTEGER DEFAULT 1'); } catch (e) {}
  try { db.exec('ALTER TABLE estudiantes ADD COLUMN tarjeta_bloqueada INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE estudiantes ADD COLUMN padre_usuario_id INTEGER'); } catch (e) {}
  try { db.exec('ALTER TABLE productos ADD COLUMN control_stock INTEGER DEFAULT 1'); } catch (e) {}
  try { db.exec('ALTER TABLE productos ADD COLUMN stock INTEGER DEFAULT 10'); } catch (e) {}
  try { db.exec('UPDATE productos SET control_stock = 1 WHERE control_stock IS NULL OR control_stock = 0'); } catch (e) {}
  try { db.exec('UPDATE productos SET stock = 10 WHERE stock IS NULL'); } catch (e) {}
  try { db.exec('ALTER TABLE usuarios ADD COLUMN activo INTEGER DEFAULT 1'); } catch (e) {}
  try { db.exec('UPDATE usuarios SET activo = 1 WHERE activo IS NULL'); } catch (e) {}

  // 8. Relación N:M Padres - Estudiantes
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS padres_estudiantes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        padre_usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(padre_usuario_id, estudiante_id)
      );
    `);
    db.exec(`
      INSERT OR IGNORE INTO padres_estudiantes (padre_usuario_id, estudiante_id)
      SELECT padre_usuario_id, id FROM estudiantes WHERE padre_usuario_id IS NOT NULL;
    `);
  } catch (e) {}

  // 9. Auditoría de Reversiones de Cargos y Recargas
  try { db.exec('ALTER TABLE transacciones_saldo ADD COLUMN revertida INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE transacciones_saldo ADD COLUMN revertido_por_usuario_id INTEGER REFERENCES usuarios(id)'); } catch (e) {}
  try { db.exec('ALTER TABLE transacciones_saldo ADD COLUMN revertido_en DATETIME'); } catch (e) {}

  // 9.1 Garantizar nombre_producto histórico en orden_detalles
  try { db.exec('ALTER TABLE orden_detalles ADD COLUMN nombre_producto TEXT'); } catch (e) {}
  try {
    db.exec(`
      UPDATE orden_detalles 
      SET nombre_producto = (SELECT nombre FROM productos WHERE productos.id = orden_detalles.producto_id)
      WHERE (nombre_producto IS NULL OR nombre_producto = '') AND producto_id IS NOT NULL;
    `);
  } catch (e) {}

  // 10. Diseños de Tarjetas Virtuales para Estudiantes
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS disenos_tarjetas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        theme_id TEXT UNIQUE NOT NULL,
        nombre TEXT NOT NULL,
        categoria TEXT DEFAULT 'uni', -- 'fem', 'masc', 'uni'
        imagen_url TEXT NOT NULL,
        estilo_texto TEXT DEFAULT 'dark', -- 'dark' (texto blanco) o 'light' (texto oscuro)
        es_predeterminado INTEGER DEFAULT 0,
        activo INTEGER DEFAULT 1,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {}

  // 11. Solicitudes de Recarga SINPE Móvil
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS solicitudes_recarga_sinpe (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        estudiante_id INTEGER NOT NULL REFERENCES estudiantes(id) ON DELETE CASCADE,
        padre_usuario_id INTEGER,
        monto_colones INTEGER NOT NULL,
        comprobante_sinpe TEXT NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        notas TEXT,
        aprobado_por_usuario_id INTEGER,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        procesado_en DATETIME
      );
    `);
    try { db.exec('ALTER TABLE solicitudes_recarga_sinpe ADD COLUMN codigo_detalle TEXT;'); } catch (_) {}
  } catch (e) {}

  // 11b. Transacciones Bancarias SINPE Detectadas por Correo / IMAP
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sinpe_transacciones_banco (
        id TEXT PRIMARY KEY,
        reference_number TEXT,
        codigo_detalle TEXT,
        codigo_detalle_norm TEXT,
        amount_crc NUMERIC NOT NULL,
        sender_phone TEXT,
        sender_name TEXT,
        origin_bank TEXT,
        status TEXT DEFAULT 'unclaimed',
        claimed_by_estudiante_id INTEGER,
        raw_data TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        verified_at DATETIME
      );
    `);
  } catch (e) {}

  // 12. Suscripciones Web Push (VAPID) para Alertas en Segundo Plano (App Cerrada)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT UNIQUE NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_id INTEGER,
        rol TEXT,
        escuela_id INTEGER,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {}

  migrarTrazabilidadSinpeRechazadas();
  seedInitialData();
  seedUsuarios();
  seedDisenosTarjetas();
}

function migrarTrazabilidadSinpeRechazadas() {
  try {
    const rechazadasSinMov = db.prepare(`
      SELECT s.*, e.saldo_colones as saldo_actual
      FROM solicitudes_recarga_sinpe s
      JOIN estudiantes e ON s.estudiante_id = e.id
      WHERE s.estado = 'rechazada'
        AND NOT EXISTS (
          SELECT 1 FROM transacciones_saldo t 
          WHERE t.tipo = 'sinpe_rechazado' 
            AND t.estudiante_id = s.estudiante_id
            AND (t.comprobante_sinpe = s.comprobante_sinpe OR (s.codigo_detalle IS NOT NULL AND t.comprobante_sinpe = s.codigo_detalle))
        )
    `).all();

    if (rechazadasSinMov && rechazadasSinMov.length > 0) {
      console.log(`[Trazabilidad SINPE] Sincronizando ${rechazadasSinMov.length} solicitudes rechazadas previas en transacciones_saldo...`);
      for (const r of rechazadasSinMov) {
        const motivoRechazo = r.notas || 'Comprobante no verificado en cuenta';
        const comp = r.comprobante_sinpe || r.codigo_detalle || 'N/A';
        const fechaTx = r.procesado_en || r.creado_en || new Date().toISOString();
        db.prepare(`
          INSERT INTO transacciones_saldo 
          (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, comprobante_sinpe, descripcion, fecha)
          VALUES (?, 'sinpe_rechazado', ?, ?, ?, ?, ?, ?)
        `).run(
          r.estudiante_id,
          r.monto_colones,
          r.saldo_actual || 0,
          r.saldo_actual || 0,
          r.comprobante_sinpe || r.codigo_detalle || 'SINPE-RECHAZADO',
          `SINPE Rechazado: ${motivoRechazo} (Comprobante #${comp})`,
          fechaTx
        );
      }
      console.log('[Trazabilidad SINPE] Sincronización retroactiva completada con éxito.');
    }
  } catch (e) {
    console.warn('Migración trazabilidad sinpe rechazadas:', e.message);
  }
}

function seedUsuarios() {
  const res = db.prepare('SELECT COUNT(*) as count FROM usuarios').get();
  const count = res ? Number(res.count) : 0;
  if (count === 0) {
    console.log('👤 Creando usuarios iniciales de demostración en RecreoPay...');
    const insert = db.prepare('INSERT INTO usuarios (username, password_hash, rol, nombre, telefono, email, activo) VALUES (?, ?, ?, ?, ?, ?, ?)');
    
    // 0. Developer Master
    insert.run('dev', 'dev123', 'developer', 'Master Developer', '+506 8888-9999', 'dev@recreopay.cr', 1);

    // 1. Admin de la Soda
    insert.run('admin', 'admin123', 'admin', 'Administrador de la Soda', '+506 8888-7632', 'admin@recreopay.cr', 1);
    
    // 2. Cajero de la Soda
    insert.run('cajero', 'cajero123', 'cajero', 'Cajero de la Soda', '+506 8888-0000', 'caja@recreopay.cr', 1);

    // 3. Padre de Mateo
    const resPadre = insert.run('padre', 'padre123', 'padre', 'Carlos Alvarado (Papá)', '+506 8888-1122', 'carlos.alvarado@gmail.com', 1);
    
    // 4. Estudiantes
    const resMateo = insert.run('mateo', '1234', 'estudiante', 'Mateo Alvarado Castro', '', '', 1);
    const resSofia = insert.run('sofia', '1234', 'estudiante', 'Sofía Jiménez Morales', '', '', 1);

    // Vincular Mateo con su usuario y su padre
    try {
      db.prepare('UPDATE estudiantes SET usuario_id = ?, padre_usuario_id = ? WHERE id = 1').run(resMateo.lastInsertRowid, resPadre.lastInsertRowid);
      db.prepare('UPDATE estudiantes SET usuario_id = ? WHERE id = 2').run(resSofia.lastInsertRowid);
    } catch (e) {}
  } else {
    // Asegurar que el usuario developer 'dev' exista
    try {
      const dev = db.prepare("SELECT id FROM usuarios WHERE username = 'dev'").get();
      if (!dev) {
        db.prepare("INSERT INTO usuarios (username, password_hash, rol, nombre, telefono, email, activo) VALUES ('dev', 'dev123', 'developer', 'Master Developer', '+506 8888-9999', 'dev@recreopay.cr', 1)").run();
      }
    } catch (e) {}

    // Asegurar que el usuario cajero exista en bases de datos ya pobladas
    try {
      const cajero = db.prepare("SELECT id FROM usuarios WHERE username = 'cajero'").get();
      if (!cajero) {
        db.prepare("INSERT INTO usuarios (username, password_hash, rol, nombre, telefono, email, activo) VALUES ('cajero', 'cajero123', 'cajero', 'Cajero de la Soda', '+506 8888-0000', 'caja@recreopay.cr', 1)").run();
      }
    } catch (e) {}
  }
}

function seedDisenosTarjetas() {
  try {
    const res = db.prepare('SELECT COUNT(*) as count FROM disenos_tarjetas').get();
    const count = res ? Number(res.count) : 0;
    if (count > 0) return;

    console.log('🎨 Inicializando colección de 16 diseños de tarjetas en RecreoPay...');
    const insert = db.prepare(`
      INSERT INTO disenos_tarjetas (theme_id, nombre, categoria, imagen_url, estilo_texto, es_predeterminado, activo)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);

    // 6 Femeninos
    insert.run('card_fem_gatito', 'Gatito Tierno (Kitten Love)', 'fem', '/img/cards/card_fem_gatito.jpg', 'light', 0);
    insert.run('card_fem_unicornio', 'Unicornio de Ensueño', 'fem', '/img/cards/card_fem_unicornio.svg', 'light', 0);
    insert.run('card_fem_sirena', 'Océano de Sirena', 'fem', '/img/cards/card_fem_sirena.svg', 'light', 0);
    insert.run('card_fem_gamer', 'Gamer Girl Pastel', 'fem', '/img/cards/card_fem_gamer.svg', 'light', 0);
    insert.run('card_fem_ballet', 'Ballet & Danza', 'fem', '/img/cards/card_fem_ballet.svg', 'light', 0);
    insert.run('card_fem_mariposas', 'Jardín Botánico & Mariposas', 'fem', '/img/cards/card_fem_mariposas.svg', 'light', 0);

    // 6 Masculinos
    insert.run('card_estrellas_futbol', 'Estrellas del Campo (Fútbol)', 'masc', '/img/cards/card_estrellas_futbol.jpg', 'dark', 0);
    insert.run('card_eco_aventura', 'Eco-Aventura', 'masc', '/img/cards/card_eco_aventura.jpg', 'light', 0);
    insert.run('card_pixel_quest', 'Pixel Quest (Videojuegos)', 'masc', '/img/cards/card_pixel_quest.jpg', 'dark', 0);
    insert.run('card_exploracion_galactica', 'Exploración Galáctica', 'masc', '/img/cards/card_exploracion_galactica.jpg', 'dark', 0);
    insert.run('card_masc_skate', 'Skate Park & Street Art', 'masc', '/img/cards/card_masc_skate.svg', 'light', 0);
    insert.run('card_masc_carreras', 'Velocidad Super Carreras', 'masc', '/img/cards/card_masc_carreras.svg', 'dark', 0);

    // 4 Unisex
    insert.run('card_robo_lab', 'Robo-Lab Tech', 'uni', '/img/cards/card_robo_lab.jpg', 'dark', 1);
    insert.run('card_mundo_arte', 'Mundo de Arte', 'uni', '/img/cards/card_mundo_arte.jpg', 'light', 0);
    insert.run('card_uni_musica', 'Ritmo & Beats (DJ)', 'uni', '/img/cards/card_uni_musica.svg', 'dark', 0);
    insert.run('card_uni_titanium', 'Titanium Metal Edition', 'uni', '/img/cards/card_uni_titanium.svg', 'dark', 0);
  } catch (err) {
    console.error('Error inicializando diseños de tarjetas:', err.message);
  }
}

function seedInitialData() {
  const existingProducts = db.prepare('SELECT COUNT(*) as count FROM productos').get();
  if (existingProducts.count > 0) return;

  console.log('🌱 Inicializando datos de prueba para RecreoPay...');

  // 1. Categorías
  const insertCat = db.prepare('INSERT INTO categorias (nombre, icono, orden) VALUES (?, ?, ?)');
  insertCat.run('Meriendas Saludables', '🥪', 1);
  insertCat.run('Platos Fuertes y Pintos', '🍛', 2);
  insertCat.run('Bebidas y Frescos', '🧃', 3);
  insertCat.run('Frutas y Snacks', '🍎', 4);

  // 2. Productos Ticos para Soda Escolar
  const insertProd = db.prepare(`
    INSERT INTO productos 
    (categoria_id, nombre, descripcion, precio_colones, icono, calorias, cumple_mep, alergenos, destacado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Meriendas
  insertProd.run(1, 'Empanada Arreglada de Carne', 'Empanada casera horneada con repollo fresco y carne mechada.', 1200, '🥟', 280, 1, 'gluten', 1);
  insertProd.run(1, 'Empanada de Queso Tierno', 'Masa suave de maíz con queso blanco semiduro artesanal.', 1000, '🥟', 250, 1, 'lactosa', 0);
  insertProd.run(1, 'Sandwich Escolar de Jamón y Queso', 'Pan integral, jamón de pavo, queso blanco, lechuga y tomate.', 1100, '🥪', 230, 1, 'gluten, lactosa', 1);
  insertProd.run(1, 'Taco Tico Crujiente', 'Tortilla de maíz con carne mechada, repollo y salsas caseras.', 1300, '🌮', 310, 1, '', 0);

  // Platos fuertes
  insertProd.run(2, 'Gallo Pinto Escolar Completo', 'Pinto tradicional con huevo picado, queso fresco y natilla.', 1500, '🍳', 380, 1, 'lactosa', 1);
  insertProd.run(2, 'Arroz con Pollo en Porción Escolar', 'Clásico arroz con pollo tico, frijoles molidos y ensalada rusa.', 1800, '🍗', 420, 1, '', 1);
  insertProd.run(2, 'Casadito Infantil', 'Bistec en salsa suave, arroz blanco, frijoles tiernos y plátano maduro.', 2000, '🍛', 450, 1, '', 0);

  // Bebidas
  insertProd.run(3, 'Fresco Natural de Cas (350ml)', 'Fruta 100% natural endulzada con moderación según norma MEP.', 700, '🍹', 90, 1, '', 1);
  insertProd.run(3, 'Fresco Natural de Mora (350ml)', 'Mora fresca de altura rica en antioxidantes.', 700, '🥤', 95, 1, '', 0);
  insertProd.run(3, 'Té Frío Casero con Limón', 'Té negro natural infusionado con limón fresco.', 650, '🧃', 70, 1, '', 0);
  insertProd.run(3, 'Leche con Chocolate Semidescremada', 'Caja de 250ml fortalecida con calcio y vitamina D.', 800, '🥛', 140, 1, 'lactosa', 0);

  // Frutas y snacks
  insertProd.run(4, 'Vaso de Fruta Picada Mixta', 'Sandía, piña y papaya dulce en cubos frescos.', 800, '🍉', 75, 1, '', 1);
  insertProd.run(4, 'Yogurt Natural con Granola y Miel', 'Vaso de yogurt artesanal con avena crujiente.', 950, '🥣', 180, 1, 'lactosa, gluten', 1);
  insertProd.run(4, 'Barra de Avena y Semillas', 'Horneada en la soda, libre de sellos de exceso de azúcar.', 550, '🌾', 120, 1, '', 0);
  insertProd.run(4, 'Gelatina Tricolor con Leche', 'Postre ligero y divertido para el recreo.', 600, '🍮', 110, 1, 'lactosa', 0);

  // 3. Estudiantes de Prueba (Primaria y Secundaria)
  const insertEst = db.prepare(`
    INSERT INTO estudiantes 
    (codigo_estudiante, nombre_completo, edad, grado, seccion, qr_token, pin_seguridad, foto_url, saldo_colones, limite_diario_colones, alergias, padre_nombre, padre_telefono)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Niños de Primaria (7 a 10 años)
  insertEst.run(
    'EST-2026-001',
    'Mateo Alvarado Castro',
    8,
    '2° Grado',
    '2-A',
    'QR-MATEO-2026-A891',
    '1234',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Mateo&backgroundColor=b6e3f4',
    4500,
    2500,
    'Ninguna conocida',
    'Carlos Alvarado (Papá)',
    '+506 8888-1122'
  );

  insertEst.run(
    'EST-2026-002',
    'Sofía Jiménez Morales',
    9,
    '3° Grado',
    '3-B',
    'QR-SOFIA-2026-B442',
    '1234',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Sofia&backgroundColor=ffd5dc',
    3200,
    2000,
    'Intolerancia leve a la lactosa',
    'Mariana Morales (Mamá)',
    '+506 8777-3344'
  );

  insertEst.run(
    'EST-2026-003',
    'Lucía Fernández Solís',
    7,
    '1° Grado',
    '1-A',
    'QR-LUCIA-2026-C119',
    '1234',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Lucia&backgroundColor=d1d4f9',
    1800,
    1500,
    'Alérgica al maní y frutos secos',
    'Elena Solís (Mamá)',
    '+506 8666-5566'
  );

  // Adolescentes de Secundaria (11 a 15 años)
  insertEst.run(
    'EST-2026-004',
    'Ignacio Vargas Chaves',
    14,
    '8° Año',
    '8-3',
    'QR-NACHO-2026-D902',
    '1234',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Ignacio&backgroundColor=c0aede',
    6000,
    3500,
    'Ninguna',
    'Roberto Vargas (Papá)',
    '+506 8333-7788'
  );

  insertEst.run(
    'EST-2026-005',
    'Valentina Rojas Quesada',
    13,
    '7° Año',
    '7-1',
    'QR-VALE-2026-E715',
    '1234',
    'https://api.dicebear.com/7.x/bottts/svg?seed=Vale&backgroundColor=ffdfbf',
    5200,
    3000,
    'Vegetariana',
    'Patricia Quesada (Mamá)',
    '+506 8999-0011'
  );

  // Asignar PIN por defecto únicamente si algún estudiante no tiene PIN definido
  db.prepare("UPDATE estudiantes SET pin_seguridad = '1234' WHERE pin_seguridad IS NULL OR pin_seguridad = ''").run();

  console.log('✅ Base de datos inicializada con éxito.');
}

// ==========================================
// TRANSACCIONES ATÓMICAS FINANCIERAS (ACID)
// ==========================================

/**
 * Realiza el débito por compra (Mostrador o Preorden)
 * Verifica saldo suficiente y límite diario establecido por el padre.
 */
function debitoCompraTransaction({ estudianteId, montoTotal, ordenId, descripcion, tipoOrden = 'compra_mostrador' }) {
  const transaction = db.transaction(() => {
    // 1. Obtener estudiante con bloqueo
    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estudianteId);
    if (!est) throw new Error('Estudiante no encontrado');
    if (!est.activo) throw new Error('La cuenta del estudiante se encuentra inactiva');
    if (est.tarjeta_bloqueada) {
      throw new Error('⛔ Tarjeta suspendida por la administración de la soda.');
    }

    // 2. Verificar saldo
    if (est.saldo_colones < montoTotal) {
      throw new Error(`Saldo insuficiente. Saldo actual: ₡${est.saldo_colones.toLocaleString('es-CR')}, Total: ₡${montoTotal.toLocaleString('es-CR')}`);
    }

    // 3. Verificar límite diario
    const gastoHoyRow = db.prepare(`
      SELECT COALESCE(SUM(ABS(monto_colones)), 0) as total_gastado_hoy
      FROM transacciones_saldo
      WHERE estudiante_id = ? AND monto_colones < 0 AND date(fecha, 'localtime') = date('now', 'localtime')
    `).get(estudianteId);

    const totalGastadoHoy = gastoHoyRow ? gastoHoyRow.total_gastado_hoy : 0;
    if (totalGastadoHoy + montoTotal > est.limite_diario_colones) {
      const disponibleHoy = Math.max(0, est.limite_diario_colones - totalGastadoHoy);
      throw new Error(`Límite diario superado. Su límite por día es ₡${est.limite_diario_colones.toLocaleString('es-CR')}. Disponible hoy: ₡${disponibleHoy.toLocaleString('es-CR')}`);
    }

    // 4. Actualizar saldo
    const nuevoSaldo = est.saldo_colones - montoTotal;
    db.prepare('UPDATE estudiantes SET saldo_colones = ? WHERE id = ?').run(nuevoSaldo, estudianteId);

    // 5. Registrar auditoría financiera
    db.prepare(`
      INSERT INTO transacciones_saldo 
      (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, orden_id, descripcion)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      estudianteId,
      tipoOrden,
      -montoTotal,
      est.saldo_colones,
      nuevoSaldo,
      ordenId || null,
      descripcion || 'Compra en soda escolar'
    );

    const nuevoGastadoHoy = totalGastadoHoy + montoTotal;
    const nuevoDisponibleHoy = Math.max(0, est.limite_diario_colones - nuevoGastadoHoy);

    return {
      exito: true,
      estudiante: {
        id: est.id,
        nombre: est.nombre_completo,
        grado: est.grado,
        seccion: est.seccion,
        foto_url: est.foto_url,
        saldo_anterior: est.saldo_colones,
        saldo_nuevo: nuevoSaldo,
        limite_diario: est.limite_diario_colones,
        gastado_hoy: nuevoGastadoHoy,
        disponible_hoy: nuevoDisponibleHoy
      }
    };
  });

  return transaction();
}

/**
 * Realiza una recarga de saldo (Ej. Vía SINPE Móvil)
 */
function recargaSaldoTransaction({ estudianteId, monto, comprobanteSinpe, descripcion }) {
  const transaction = db.transaction(() => {
    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estudianteId);
    if (!est) throw new Error('Estudiante no encontrado');
    if (monto <= 0) throw new Error('El monto de recarga debe ser mayor a ₡0');

    const nuevoSaldo = est.saldo_colones + monto;
    db.prepare('UPDATE estudiantes SET saldo_colones = ? WHERE id = ?').run(nuevoSaldo, estudianteId);

    db.prepare(`
      INSERT INTO transacciones_saldo 
      (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, comprobante_sinpe, descripcion)
      VALUES (?, 'recarga_sinpe', ?, ?, ?, ?, ?)
    `).run(
      estudianteId,
      monto,
      est.saldo_colones,
      nuevoSaldo,
      comprobanteSinpe || 'SINPE-APP',
      descripcion || `Recarga SINPE Móvil por ₡${monto.toLocaleString('es-CR')}`
    );

    return {
      exito: true,
      estudiante_id: est.id,
      nombre: est.nombre_completo,
      saldo_anterior: est.saldo_colones,
      saldo_nuevo: nuevoSaldo
    };
  });

  return transaction();
}

/**
 * Crea una orden completa (Mostrador o Preorden) con sus ítems
 */
function crearOrdenCompleta({ estudianteId, tipoOrden, momentoEntrega, notas, items }) {
  const transaction = db.transaction(() => {
    if (!items || items.length === 0) throw new Error('La orden no contiene productos');

    // Calcular total y validar productos
    let totalColones = 0;
    const detallesParaInsertar = [];

    for (const item of items) {
      const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(item.producto_id);
      if (!prod) throw new Error(`Producto #${item.producto_id} no existe`);
      if (!prod.disponible) throw new Error(`El producto "${prod.nombre}" no está disponible en este momento`);

      const cantidad = parseInt(item.cantidad, 10) || 1;
      if (prod.control_stock === 1) {
        if (prod.stock < cantidad) {
          throw new Error(`Existencias insuficientes para "${prod.nombre}". Quedan ${prod.stock} unidad(es) en inventario.`);
        }
      }

      const subtotal = prod.precio_colones * cantidad;
      totalColones += subtotal;

      detallesParaInsertar.push({
        producto_id: prod.id,
        nombre: prod.nombre,
        cantidad,
        precio_unitario: prod.precio_colones,
        subtotal
      });
    }

    // Generar código de orden único
    const countOrders = db.prepare('SELECT COUNT(*) as count FROM ordenes').get().count + 1001;
    const codigoOrden = `ORD-${countOrders}`;

    // Estado inicial: si es mostrador nace entregado; si es preorden nace pendiente
    const estadoInicial = tipoOrden === 'mostrador' ? 'entregado' : 'pendiente';
    const entregadoEn = tipoOrden === 'mostrador' ? new Date().toISOString() : null;

    // Consultar estudiante para registrar saldos históricos y evitar campos NULL
    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estudianteId);
    if (!est) throw new Error(`Estudiante #${estudianteId} no existe`);
    const saldoAnterior = est.saldo_colones;
    const saldoPosterior = Math.max(0, saldoAnterior - totalColones);
    const cajeroVal = (tipoOrden === 'mostrador' ? 6 : 1);
    const obsVal = (tipoOrden === 'mostrador' ? 'Venta realizada en mostrador' : 'Pre-orden retiro en recreo');
    const notasVal = notas || '';
    const momentoVal = momentoEntrega || (tipoOrden === 'mostrador' ? 'inmediato' : 'recreo_1');

    const escuelaId = (est && est.escuela_id) ? est.escuela_id : 1;

    // Insertar orden cabecera con todos sus campos completos
    const resultOrden = db.prepare(`
      INSERT INTO ordenes 
      (codigo_orden, estudiante_id, cajero_id, tipo_orden, momento_entrega, estado, total_colones, saldo_anterior, saldo_posterior, metodo_pago, notas, observaciones, entregado_en, escuela_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'monedero_qr', ?, ?, ?, ?)
    `).run(
      codigoOrden,
      estudianteId,
      cajeroVal,
      tipoOrden,
      momentoVal,
      estadoInicial,
      totalColones,
      saldoAnterior,
      saldoPosterior,
      notasVal,
      obsVal,
      entregadoEn,
      escuelaId
    );

    const ordenId = resultOrden.lastInsertRowid;

    // Insertar detalle de productos y descontar inventario
    const insertDetalle = db.prepare(`
      INSERT INTO orden_detalles (orden_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const productosActualizados = [];
    for (const det of detallesParaInsertar) {
      const nombreProd = det.nombre || `Producto #${det.producto_id}`;
      insertDetalle.run(ordenId, det.producto_id, nombreProd, det.cantidad, det.precio_unitario, det.subtotal);

      // Descontar inventario si tiene control de stock activo
      const prod = db.prepare('SELECT control_stock, stock FROM productos WHERE id = ?').get(det.producto_id);
      if (prod && prod.control_stock === 1) {
        const nuevoStock = Math.max(0, prod.stock - det.cantidad);
        const sigueDisponible = nuevoStock > 0 ? 1 : 0;
        db.prepare('UPDATE productos SET stock = ?, disponible = ? WHERE id = ?').run(nuevoStock, sigueDisponible, det.producto_id);

        const prodActualizado = db.prepare(`
          SELECT p.*, c.nombre as categoria_nombre, c.icono as categoria_icono
          FROM productos p
          LEFT JOIN categorias c ON p.categoria_id = c.id
          WHERE p.id = ?
        `).get(det.producto_id);
        if (prodActualizado) {
          productosActualizados.push(prodActualizado);
        }
      }
    }

    // Efectuar débito financiero
    const resultadoDebito = debitoCompraTransaction({
      estudianteId,
      montoTotal: totalColones,
      ordenId,
      descripcion: `Orden ${codigoOrden} (${tipoOrden})`,
      tipoOrden: tipoOrden === 'mostrador' ? 'compra_mostrador' : 'preorden'
    });

    return {
      orden_id: ordenId,
      codigo_orden: codigoOrden,
      estudiante_id: estudianteId,
      tipo_orden: tipoOrden,
      momento_entrega: momentoEntrega,
      estado: estadoInicial,
      total_colones: totalColones,
      detalles: detallesParaInsertar,
      productosActualizados,
      financiero: resultadoDebito
    };
  });

  return transaction();
}

/**
 * Realiza una transferencia P2P directa entre estudiantes (Opción 2: Escaneando al compañero)
 * Transacción atómica ACID que verifica saldo, permisos parentales y PIN.
 */
function transferenciaP2PTransaction({ emisorId, qrReceptor, receptorId, monto, pin, motivo }) {
  const transaction = db.transaction(() => {
    // 1. Obtener emisor
    const emisor = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(emisorId);
    if (!emisor) throw new Error('Estudiante emisor no encontrado');
    if (!emisor.activo) throw new Error('Tu cuenta se encuentra inactiva');
    if (emisor.tarjeta_bloqueada) {
      throw new Error('⛔ Tarjeta suspendida por la administración de la soda. No puedes transferir.');
    }
    if (emisor.permitir_transferencias === 0) {
      throw new Error('Tus padres tienen desactivadas las transferencias entre compañeros en tu perfil');
    }

    // 2. Validar PIN de seguridad del emisor (debe coincidir exactamente con su PIN registrado)
    const pinIngresado = String(pin || '').trim();
    const pinEstudiante = String(emisor.pin_seguridad || '').trim();
    if (!pinIngresado) {
      throw new Error('Debes ingresar tu PIN de seguridad');
    }
    if (pinIngresado !== pinEstudiante) {
      throw new Error('El PIN de seguridad es incorrecto.');
    }

    // 3. Obtener receptor (por ID o por escaneo de QR/código de carné)
    let receptor = null;
    if (receptorId) {
      receptor = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(receptorId);
    } else if (qrReceptor) {
      receptor = db.prepare('SELECT * FROM estudiantes WHERE qr_token = ? OR codigo_estudiante = ?').get(qrReceptor, qrReceptor);
    }

    if (!receptor) {
      throw new Error('Código QR no corresponde a ningún estudiante registrado');
    }
    if (!receptor.activo) {
      throw new Error(`La cuenta de ${receptor.nombre_completo} se encuentra inactiva`);
    }
    if (receptor.tarjeta_bloqueada) {
      throw new Error(`⛔ La tarjeta de ${receptor.nombre_completo} está suspendida y no puede recibir transferencias.`);
    }
    if (emisor.id === receptor.id) {
      throw new Error('No puedes transferirte saldo a ti mismo');
    }

    // 4. Validar monto
    const montoColones = parseInt(monto, 10);
    if (isNaN(montoColones) || montoColones <= 0) {
      throw new Error('El monto a transferir debe ser mayor a ₡0');
    }
    if (montoColones > 3000) {
      throw new Error('Por seguridad escolar, el tope máximo por transferencia es de ₡3.000');
    }
    if (emisor.saldo_colones < montoColones) {
      throw new Error(`Saldo insuficiente. Tienes ₡${emisor.saldo_colones.toLocaleString('es-CR')} y deseas transferir ₡${montoColones.toLocaleString('es-CR')}`);
    }

    // 5. Actualizar saldos atómicamente
    const nuevoSaldoEmisor = emisor.saldo_colones - montoColones;
    const nuevoSaldoReceptor = receptor.saldo_colones + montoColones;

    db.prepare('UPDATE estudiantes SET saldo_colones = ? WHERE id = ?').run(nuevoSaldoEmisor, emisor.id);
    db.prepare('UPDATE estudiantes SET saldo_colones = ? WHERE id = ?').run(nuevoSaldoReceptor, receptor.id);

    // 6. Registrar en el historial y auditoría de ambos
    const motivoTexto = motivo && motivo.trim() ? ` (${motivo.trim()})` : '';
    const descEmisor = `Pase a ${receptor.nombre_completo}${motivoTexto}`;
    const descReceptor = `Pase de ${emisor.nombre_completo}${motivoTexto}`;

    db.prepare(`
      INSERT INTO transacciones_saldo 
      (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, descripcion)
      VALUES (?, 'transferencia_enviada', ?, ?, ?, ?)
    `).run(emisor.id, -montoColones, emisor.saldo_colones, nuevoSaldoEmisor, descEmisor);

    db.prepare(`
      INSERT INTO transacciones_saldo 
      (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, descripcion)
      VALUES (?, 'transferencia_recibida', ?, ?, ?, ?)
    `).run(receptor.id, montoColones, receptor.saldo_colones, nuevoSaldoReceptor, descReceptor);

    return {
      exito: true,
      monto: montoColones,
      motivo: motivo || 'Pase entre compas',
      emisor: {
        id: emisor.id,
        nombre: emisor.nombre_completo,
        saldo_anterior: emisor.saldo_colones,
        saldo_nuevo: nuevoSaldoEmisor
      },
      receptor: {
        id: receptor.id,
        nombre: receptor.nombre_completo,
        grado: receptor.grado,
        seccion: receptor.seccion,
        foto_url: receptor.foto_url,
        saldo_anterior: receptor.saldo_colones,
        saldo_nuevo: nuevoSaldoReceptor
      }
    };
  });

  return transaction();
}

/**
 * Reversión de un cargo o recarga errónea
 * Rol cajero: solo permitido en los primeros 10 minutos
 * Rol admin: permitido en cualquier momento
 */
function revertirTransaccionSaldoTransaction({ transaccionId, usuarioId, usuarioRol }) {
  const transaction = db.transaction(() => {
    // 1. Obtener la transacción original y los minutos transcurridos
    const tx = db.prepare(`
      SELECT t.*, 
        ROUND((strftime('%s', 'now') - strftime('%s', t.fecha)) / 60.0, 1) as minutos_transcurridos
      FROM transacciones_saldo t 
      WHERE t.id = ?
    `).get(transaccionId);

    if (!tx) {
      throw new Error('Transacción no encontrada en los registros');
    }

    if (tx.revertida === 1) {
      throw new Error('Esta transacción ya fue revertida previamente');
    }

    if (tx.tipo === 'reversion_recarga' || tx.tipo === 'reembolso' || tx.tipo === 'sinpe_rechazado') {
      throw new Error('No es posible revertir una transacción que fue rechazada o que ya corresponde a una reversión o reembolso');
    }

    // 2. Control de tiempo según el rol (Cajero: <= 10 min, Admin: ilimitado)
    const minutos = parseFloat(tx.minutos_transcurridos) || 0;
    if (usuarioRol === 'cajero' && minutos > 10) {
      throw new Error(`Han transcurrido ${Math.round(minutos)} minutos desde este movimiento. Un usuario con rol de Cajero solo puede revertir durante los primeros 10 minutos. Esta operación debe ser realizada por un Administrador.`);
    }

    // 3. Obtener el estudiante involucrado
    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(tx.estudiante_id);
    if (!est) {
      throw new Error('El estudiante asociado a este movimiento no fue encontrado');
    }

    let resultado = {};

    // 4. Caso A: Reversión de Recarga de Dinero (monto positivo ingresado al monedero)
    if (tx.monto_colones > 0 || tx.tipo === 'recarga_manual' || tx.tipo === 'recarga_sinpe' || tx.tipo === 'transferencia_recibida') {
      const montoRevertir = Math.abs(tx.monto_colones);
      const nuevoSaldo = est.saldo_colones - montoRevertir;

      // Actualizar saldo del estudiante (puede quedar en negativo según la decisión acordada)
      db.prepare('UPDATE estudiantes SET saldo_colones = ? WHERE id = ?').run(nuevoSaldo, est.id);

      // Marcar transacción original como revertida
      db.prepare(`
        UPDATE transacciones_saldo 
        SET revertida = 1, revertido_por_usuario_id = ?, revertido_en = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(usuarioId || null, tx.id);

      // Registrar auditoría de reversión
      db.prepare(`
        INSERT INTO transacciones_saldo 
        (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, comprobante_sinpe, descripcion)
        VALUES (?, 'reversion_recarga', ?, ?, ?, 'REVERSION', ?)
      `).run(
        est.id,
        -montoRevertir,
        est.saldo_colones,
        nuevoSaldo,
        `Reversión de recarga #${tx.id} (${tx.descripcion || 'Recarga'})`
      );

      resultado = {
        exito: true,
        tipo_operacion: 'reversion_recarga',
        transaccion_id: tx.id,
        estudiante_id: est.id,
        nombre_completo: est.nombre_completo,
        monto_revertido: montoRevertir,
        saldo_anterior: est.saldo_colones,
        saldo_nuevo: nuevoSaldo,
        mensaje: `Se revirtió exitosamente la recarga de ₡${montoRevertir.toLocaleString('es-CR')} a ${est.nombre_completo}. Nuevo saldo: ₡${nuevoSaldo.toLocaleString('es-CR')}.`
      };
    } 
    // 5. Caso B: Reversión de Cobro de Mostrador / Compra de Merienda (monto debitado al alumno)
    else {
      const montoReembolso = Math.abs(tx.monto_colones);
      const nuevoSaldo = est.saldo_colones + montoReembolso;

      // Devolver saldo al estudiante
      db.prepare('UPDATE estudiantes SET saldo_colones = ? WHERE id = ?').run(nuevoSaldo, est.id);

      let productosRestaurados = [];
      // Anular orden y devolver productos al inventario si tiene orden asociada
      if (tx.orden_id) {
        db.prepare(`
          UPDATE ordenes 
          SET estado = 'anulada', notas = COALESCE(notas || ' | ', '') || 'Revertida en caja/admin' 
          WHERE id = ?
        `).run(tx.orden_id);

        const detalles = db.prepare('SELECT producto_id, cantidad FROM orden_detalles WHERE orden_id = ?').all(tx.orden_id);
        for (const det of detalles) {
          db.prepare(`
            UPDATE productos 
            SET stock = stock + ?, disponible = 1 
            WHERE id = ? AND control_stock = 1
          `).run(det.cantidad, det.producto_id);

          productosRestaurados.push({ producto_id: det.producto_id, cantidad: det.cantidad });
        }
      }

      // Marcar transacción original como revertida
      db.prepare(`
        UPDATE transacciones_saldo 
        SET revertida = 1, revertido_por_usuario_id = ?, revertido_en = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(usuarioId || null, tx.id);

      // Registrar auditoría de reembolso
      db.prepare(`
        INSERT INTO transacciones_saldo 
        (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, orden_id, descripcion)
        VALUES (?, 'reembolso', ?, ?, ?, ?, ?)
      `).run(
        est.id,
        montoReembolso,
        est.saldo_colones,
        nuevoSaldo,
        tx.orden_id || null,
        `Reembolso por anulación de cobro #${tx.id} (${tx.descripcion || 'Compra mostrador'})`
      );

      resultado = {
        exito: true,
        tipo_operacion: 'reembolso_cobro',
        transaccion_id: tx.id,
        estudiante_id: est.id,
        nombre_completo: est.nombre_completo,
        monto_revertido: montoReembolso,
        saldo_anterior: est.saldo_colones,
        saldo_nuevo: nuevoSaldo,
        productos_restaurados: productosRestaurados,
        mensaje: `Se anuló el cobro de ₡${montoReembolso.toLocaleString('es-CR')} y se reintegró el dinero a ${est.nombre_completo}. Nuevo saldo: ₡${nuevoSaldo.toLocaleString('es-CR')}.`
      };
    }

    return resultado;
  });

  return transaction();
}

/**
 * Genera un código de detalle amigable y tolerante: "SIBO-" + 4 caracteres anti-confusión
 */
function generarCodigoDetalleSinpe() {
  const chars = '23456789ACDEFGHJKMNPQRSTUVWXYZ';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SIBO-${rand}`;
}

/**
 * Crea una nueva solicitud de recarga por SINPE Móvil enviada por un padre
 */
function crearSolicitudRecargaSinpe({ estudianteId, padreUsuarioId, monto, comprobante, notas, codigoDetalle }) {
  let escuelaId = 1;
  try {
    const est = db.prepare('SELECT escuela_id FROM estudiantes WHERE id = ?').get(estudianteId);
    if (est && est.escuela_id) escuelaId = est.escuela_id;
  } catch (e) {}

  const finalCodigo = codigoDetalle || generarCodigoDetalleSinpe();
  const finalComp = comprobante ? String(comprobante).trim() : `SINPE-${finalCodigo.replace(/[^A-Za-z0-9]/g, '')}`;

  const insert = db.prepare(`
    INSERT INTO solicitudes_recarga_sinpe (estudiante_id, padre_usuario_id, monto_colones, comprobante_sinpe, codigo_detalle, estado, notas, escuela_id)
    VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?)
  `);
  const res = insert.run(estudianteId, padreUsuarioId || null, parseInt(monto, 10), finalComp, finalCodigo, notas || '', escuelaId);
  return {
    id: res.lastInsertRowid || res.id,
    estudiante_id: estudianteId,
    escuela_id: escuelaId,
    monto_colones: parseInt(monto, 10),
    comprobante_sinpe: finalComp,
    codigo_detalle: finalCodigo,
    estado: 'pendiente'
  };
}

/**
 * Busca una transacción bancaria capturada por IMAP/correo para validar la recarga
 */
function buscarTransaccionSinpeBanco({ codigoDetalle, comprobante, monto }) {
  const normCod = codigoDetalle ? normalizarCodigoDetalle(codigoDetalle) : null;
  const cleanComp = comprobante ? String(comprobante).trim().replace(/^[#:\.\-\s]+/, '') : null;
  const numMonto = parseInt(monto, 10);

  // 1. Búsqueda por código de detalle normalizado (máxima prioridad)
  if (normCod && normCod.length >= 4) {
    let tx = db.prepare(`
      SELECT * FROM sinpe_transacciones_banco
      WHERE (codigo_detalle_norm = ? OR UPPER(REPLACE(REPLACE(codigo_detalle, '-', ''), ' ', '')) = ?)
        AND status = 'unclaimed'
      ORDER BY received_at DESC
      LIMIT 1
    `).get(normCod, normCod);

    if (tx) {
      if (numMonto && Math.abs(Number(tx.amount_crc) - numMonto) > 0.01) {
        return { error: 'MONTO_DISCREPANCIA', tx, mensaje: `El comprobante bancario corresponde a ₡${Number(tx.amount_crc).toLocaleString('es-CR')}, pero la recarga solicitada es por ₡${numMonto.toLocaleString('es-CR')}.` };
      }
      return { encontrado: true, tx };
    }
  }

  // 2. Búsqueda por número de comprobante emitido por el banco
  if (cleanComp && cleanComp.length >= 3) {
    let tx = db.prepare(`
      SELECT * FROM sinpe_transacciones_banco
      WHERE (reference_number = ? OR reference_number LIKE ?)
        AND status = 'unclaimed'
      ORDER BY received_at DESC
      LIMIT 1
    `).get(cleanComp, `%${cleanComp}%`);

    if (tx) {
      if (numMonto && Math.abs(Number(tx.amount_crc) - numMonto) > 0.01) {
        return { error: 'MONTO_DISCREPANCIA', tx, mensaje: `El comprobante bancario corresponde a ₡${Number(tx.amount_crc).toLocaleString('es-CR')}, pero la recarga solicitada es por ₡${numMonto.toLocaleString('es-CR')}.` };
      }
      return { encontrado: true, tx };
    }
  }

  // 3. Verificar si el código o comprobante ya fue usado previamente (anti-fraude)
  if (normCod) {
    const used = db.prepare(`
      SELECT * FROM sinpe_transacciones_banco
      WHERE codigo_detalle_norm = ? AND status = 'used'
      LIMIT 1
    `).get(normCod);

    if (used) {
      return { error: 'COMPROBANTE_YA_UTILIZADO', mensaje: `Este código de detalle ya fue utilizado anteriormente y no es válido para otra recarga.` };
    }
  } else if (cleanComp) {
    const used = db.prepare(`
      SELECT * FROM sinpe_transacciones_banco
      WHERE reference_number = ? AND status = 'used'
      LIMIT 1
    `).get(cleanComp);

    if (used) {
      return { error: 'COMPROBANTE_YA_UTILIZADO', mensaje: `Este comprobante bancario ya fue utilizado anteriormente y no es válido para otra recarga.` };
    }
  }

  return { encontrado: false };
}

function marcarTransaccionSinpeUsada(txId, estudianteId) {
  return db.prepare(`
    UPDATE sinpe_transacciones_banco
    SET status = 'used',
        claimed_by_estudiante_id = ?,
        verified_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(estudianteId || null, txId);
}

/**
 * Obtiene las solicitudes de recarga SINPE (con datos del estudiante y escuela)
 */
function obtenerSolicitudesRecargaSinpe(filtroEstado = 'pendiente', escuelaId = null) {
  let sql = `
    SELECT s.*, 
           e.nombre_completo as estudiante_nombre, 
           e.grado as estudiante_grado, 
           e.seccion as estudiante_seccion, 
           e.foto_url as estudiante_foto, 
           e.saldo_colones as estudiante_saldo,
           esc.nombre as escuela_nombre,
           esc.codigo as escuela_codigo
    FROM solicitudes_recarga_sinpe s
    JOIN estudiantes e ON e.id = s.estudiante_id
    LEFT JOIN escuelas esc ON esc.id = s.escuela_id
  `;
  const conditions = [];
  const params = [];

  if (filtroEstado && filtroEstado !== 'todas') {
    conditions.push('s.estado = ?');
    params.push(filtroEstado);
  }
  if (escuelaId) {
    conditions.push('(s.escuela_id = ? OR s.escuela_id IS NULL)');
    params.push(escuelaId);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY s.creado_en DESC';

  return db.prepare(sql).all(...params);
}

/**
 * Obtiene las solicitudes de recarga de un estudiante específico (para el portal de padres)
 */
function obtenerSolicitudesRecargaPorEstudiante(estudianteId) {
  return db.prepare(`
    SELECT * FROM solicitudes_recarga_sinpe 
    WHERE estudiante_id = ? 
    ORDER BY creado_en DESC 
    LIMIT 10
  `).all(estudianteId);
}

/**
 * Procesa (aprueba o rechaza) una solicitud de recarga SINPE
 */
function procesarSolicitudRecargaSinpe({ solicitudId, accion, usuarioId, motivo }) {
  const transaction = db.transaction(() => {
    const sol = db.prepare('SELECT * FROM solicitudes_recarga_sinpe WHERE id = ?').get(solicitudId);
    if (!sol) throw new Error('Solicitud de recarga no encontrada');
    if (sol.estado !== 'pendiente') throw new Error(`Esta solicitud ya fue ${sol.estado}`);

    if (accion === 'aprobar') {
      const resultadoSaldo = recargaSaldoTransaction({
        estudianteId: sol.estudiante_id,
        monto: sol.monto_colones,
        comprobanteSinpe: sol.comprobante_sinpe,
        descripcion: `Recarga SINPE aprobada en soda (Comprobante #${sol.comprobante_sinpe})`
      });

      db.prepare(`
        UPDATE solicitudes_recarga_sinpe 
        SET estado = 'aprobada', aprobado_por_usuario_id = ?, procesado_en = CURRENT_TIMESTAMP, notas = ?
        WHERE id = ?
      `).run(usuarioId || null, motivo || 'Aprobada por la soda', solicitudId);

      return {
        solicitud_id: solicitudId,
        estado: 'aprobada',
        estudiante_id: sol.estudiante_id,
        monto: sol.monto_colones,
        saldo_nuevo: resultadoSaldo.saldo_nuevo,
        estudiante_nombre: resultadoSaldo.nombre
      };
    } else if (accion === 'rechazar') {
      const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(sol.estudiante_id);
      const saldoActual = est ? est.saldo_colones : 0;
      const motivoRechazo = motivo || 'Comprobante no verificado en cuenta';

      db.prepare(`
        UPDATE solicitudes_recarga_sinpe 
        SET estado = 'rechazada', aprobado_por_usuario_id = ?, procesado_en = CURRENT_TIMESTAMP, notas = ?
        WHERE id = ?
      `).run(usuarioId || null, motivoRechazo, solicitudId);

      // Registrar en transacciones_saldo para trazabilidad en Movimientos y Reversiones
      const compLabel = sol.comprobante_sinpe || (sol.codigo_detalle ? `Cód: ${sol.codigo_detalle}` : 'N/A');
      const descTrazabilidad = `SINPE Rechazado: ${motivoRechazo} (Comprobante #${compLabel})`;

      db.prepare(`
        INSERT INTO transacciones_saldo 
        (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, comprobante_sinpe, descripcion)
        VALUES (?, 'sinpe_rechazado', ?, ?, ?, ?, ?)
      `).run(
        sol.estudiante_id,
        sol.monto_colones,
        saldoActual,
        saldoActual,
        sol.comprobante_sinpe || (sol.codigo_detalle ? `Cód: ${sol.codigo_detalle}` : 'SINPE-RECHAZADO'),
        descTrazabilidad
      );

      return {
        solicitud_id: solicitudId,
        estado: 'rechazada',
        estudiante_id: sol.estudiante_id,
        monto: sol.monto_colones,
        estudiante_nombre: est ? est.nombre_completo : 'Estudiante',
        motivo: motivoRechazo
      };
    } else {
      throw new Error('Acción no válida (usar aprobar o rechazar)');
    }
  });

  return transaction();
}

function guardarSuscripcionPush({ endpoint, p256dh, auth, userId = null, rol = 'cajero', escuelaId = 1 }) {
  const stmt = db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_id, rol, escuela_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_id = excluded.user_id,
      rol = excluded.rol,
      escuela_id = excluded.escuela_id,
      creado_en = CURRENT_TIMESTAMP
  `);
  return stmt.run(endpoint, p256dh, auth, userId, rol, escuelaId);
}

function obtenerSuscripcionesPush({ escuelaId = null, roles = null } = {}) {
  let query = 'SELECT * FROM push_subscriptions WHERE 1=1';
  const params = [];

  if (escuelaId) {
    query += ' AND (escuela_id = ? OR escuela_id IS NULL)';
    params.push(escuelaId);
  }

  if (roles && Array.isArray(roles) && roles.length > 0) {
    const placeholders = roles.map(() => '?').join(',');
    query += ` AND rol IN (${placeholders})`;
    params.push(...roles);
  }

  return db.prepare(query).all(...params);
}

function eliminarSuscripcionPush(endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

module.exports = {
  db,
  initDatabase,
  debitoCompraTransaction,
  recargaSaldoTransaction,
  crearOrdenCompleta,
  transferenciaP2PTransaction,
  revertirTransaccionSaldoTransaction,
  generarCodigoDetalleSinpe,
  crearSolicitudRecargaSinpe,
  buscarTransaccionSinpeBanco,
  marcarTransaccionSinpeUsada,
  obtenerSolicitudesRecargaSinpe,
  obtenerSolicitudesRecargaPorEstudiante,
  procesarSolicitudRecargaSinpe,
  guardarSuscripcionPush,
  obtenerSuscripcionesPush,
  eliminarSuscripcionPush
};
