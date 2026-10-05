const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const { db, initDatabase, debitoCompraTransaction, recargaSaldoTransaction, crearOrdenCompleta, transferenciaP2PTransaction } = require('./db');

const app = express();
const PORT = process.env.PORT || 3030;

// Initialize DB schema & seed data
initDatabase();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'), {
  etag: false,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Simple in-memory SSE clients for real-time notifications
const sseClients = new Set();

function broadcastEvent(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// SSE stream for real-time soda screen
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// ==========================================
// 0. AUTENTICACIÓN Y ROLES (ADMIN, PADRE, ESTUDIANTE)
// ==========================================

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Ingresa usuario y contraseña' });
    }

    const cleanUser = String(username).trim().toLowerCase();
    const cleanPass = String(password).trim();

    const user = db.prepare('SELECT * FROM usuarios WHERE LOWER(username) = ?').get(cleanUser);
    if (!user || user.password_hash !== cleanPass) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    let estudiante = null;
    let hijos = [];

    if (user.rol === 'estudiante') {
      estudiante = db.prepare('SELECT * FROM estudiantes WHERE usuario_id = ?').get(user.id);
      if (!estudiante) {
        estudiante = db.prepare('SELECT * FROM estudiantes WHERE LOWER(nombre_completo) LIKE ?').get(`%${cleanUser}%`);
      }
      if (!estudiante) {
        estudiante = db.prepare('SELECT * FROM estudiantes ORDER BY id ASC LIMIT 1').get();
      }
      if (estudiante) {
        const gastoHoy = db.prepare(`
          SELECT COALESCE(SUM(ABS(monto_colones)), 0) as total
          FROM transacciones_saldo
          WHERE estudiante_id = ? AND monto_colones < 0 AND date(fecha, 'localtime') = date('now', 'localtime')
        `).get(estudiante.id).total;
        estudiante.gastado_hoy = gastoHoy;
        estudiante.disponible_hoy = Math.max(0, (estudiante.limite_diario_colones || 0) - gastoHoy);
      }
    } else if (user.rol === 'padre') {
      hijos = db.prepare(`
        SELECT e.* 
        FROM estudiantes e
        JOIN padres_estudiantes pe ON e.id = pe.estudiante_id
        WHERE pe.padre_usuario_id = ?
        ORDER BY e.nombre_completo ASC
      `).all(user.id);
      if (hijos.length === 0) {
        hijos = db.prepare('SELECT * FROM estudiantes WHERE padre_usuario_id = ?').all(user.id);
      }
      hijos = hijos.map(h => {
        const gastoHoy = db.prepare(`
          SELECT COALESCE(SUM(ABS(monto_colones)), 0) as total
          FROM transacciones_saldo
          WHERE estudiante_id = ? AND monto_colones < 0 AND date(fecha, 'localtime') = date('now', 'localtime')
        `).get(h.id).total;
        return {
          ...h,
          gastado_hoy: gastoHoy,
          disponible_hoy: Math.max(0, (h.limite_diario_colones || 0) - gastoHoy)
        };
      });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        rol: user.rol,
        nombre: user.nombre,
        email: user.email,
        telefono: user.telefono
      },
      estudiante,
      hijos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registro de nuevos padres desde la pantalla de bienvenida
app.post('/api/auth/register-padre', (req, res) => {
  try {
    const { nombre, telefono, email, username, password } = req.body;
    if (!nombre || !username || !password) {
      return res.status(400).json({ error: 'Nombre completo, usuario y contraseña son requeridos' });
    }

    const cleanUser = String(username).trim().toLowerCase();
    const cleanPass = String(password).trim();
    const cleanNombre = String(nombre).trim();
    const cleanTel = telefono ? String(telefono).trim() : '';
    const cleanEmail = email ? String(email).trim().toLowerCase() : '';

    if (cleanUser.length < 3) {
      return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres' });
    }
    if (cleanPass.length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }

    // Comprobar si el usuario ya existe
    const exists = db.prepare('SELECT id FROM usuarios WHERE LOWER(username) = ?').get(cleanUser);
    if (exists) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso. Por favor elige otro.' });
    }

    const insert = db.prepare(`
      INSERT INTO usuarios (username, password_hash, rol, nombre, telefono, email)
      VALUES (?, ?, 'padre', ?, ?, ?)
    `);
    const result = insert.run(cleanUser, cleanPass, cleanNombre, cleanTel, cleanEmail);

    const newUser = {
      id: result.lastInsertRowid,
      username: cleanUser,
      rol: 'padre',
      nombre: cleanNombre,
      telefono: cleanTel,
      email: cleanEmail
    };

    res.json({
      success: true,
      user: newUser,
      hijos: []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vincular estudiante a la cuenta de padre mediante QR o código de carné
app.post('/api/padres/vincular-hijo', (req, res) => {
  try {
    const { padre_usuario_id, qr_token_o_codigo } = req.body;
    if (!padre_usuario_id || !qr_token_o_codigo) {
      return res.status(400).json({ error: 'Faltan datos de vinculación (ID de padre o código)' });
    }

    const cleanQuery = String(qr_token_o_codigo).trim();

    // Buscar al estudiante por qr_token o codigo_estudiante o id
    const est = db.prepare(`
      SELECT * FROM estudiantes 
      WHERE qr_token = ? OR codigo_estudiante = ? OR LOWER(codigo_estudiante) = LOWER(?)
    `).get(cleanQuery, cleanQuery, cleanQuery);

    if (!est) {
      return res.status(404).json({ error: 'No se encontró ningún estudiante con ese código QR o número de carné. Verifica que el código sea correcto.' });
    }

    // Insertar en tabla padres_estudiantes (permite vinculación múltiple para ambos padres)
    db.prepare(`
      INSERT OR IGNORE INTO padres_estudiantes (padre_usuario_id, estudiante_id)
      VALUES (?, ?)
    `).run(padre_usuario_id, est.id);

    // Actualizar también campo legacy en caso de ser el primer padre
    if (!est.padre_usuario_id) {
      db.prepare('UPDATE estudiantes SET padre_usuario_id = ? WHERE id = ?').run(padre_usuario_id, est.id);
    }

    // Devolver lista completa actualizada de hijos del padre
    const hijos = db.prepare(`
      SELECT e.* 
      FROM estudiantes e
      JOIN padres_estudiantes pe ON e.id = pe.estudiante_id
      WHERE pe.padre_usuario_id = ?
      ORDER BY e.nombre_completo ASC
    `).all(padre_usuario_id);

    res.json({
      success: true,
      mensaje: `¡Estudiante ${est.nombre_completo} vinculado con éxito!`,
      estudiante: est,
      hijos
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Consultar lista en tiempo real de hijos vinculados
app.get('/api/padres/mis-hijos', (req, res) => {
  try {
    const { padre_usuario_id } = req.query;
    if (!padre_usuario_id) {
      return res.status(400).json({ error: 'Falta padre_usuario_id' });
    }

    let hijos = db.prepare(`
      SELECT e.* 
      FROM estudiantes e
      JOIN padres_estudiantes pe ON e.id = pe.estudiante_id
      WHERE pe.padre_usuario_id = ?
      ORDER BY e.nombre_completo ASC
    `).all(padre_usuario_id);

    if (hijos.length === 0) {
      hijos = db.prepare('SELECT * FROM estudiantes WHERE padre_usuario_id = ?').all(padre_usuario_id);
    }

    const hijosEnriquecidos = hijos.map(h => {
      const gastoHoy = db.prepare(`
        SELECT COALESCE(SUM(ABS(monto_colones)), 0) as total
        FROM transacciones_saldo
        WHERE estudiante_id = ? AND monto_colones < 0 AND date(fecha, 'localtime') = date('now', 'localtime')
      `).get(h.id).total;
      return {
        ...h,
        gastado_hoy: gastoHoy,
        disponible_hoy: Math.max(0, (h.limite_diario_colones || 0) - gastoHoy)
      };
    });

    res.json({ success: true, hijos: hijosEnriquecidos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restablecer contraseña / PIN del estudiante desde el portal de padres
app.post('/api/padres/restablecer-acceso', (req, res) => {
  try {
    const { estudiante_id, nuevo_pin, nuevo_password } = req.body;
    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estudiante_id);
    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado' });

    if (nuevo_pin) {
      db.prepare('UPDATE estudiantes SET pin_seguridad = ? WHERE id = ?').run(String(nuevo_pin).trim(), est.id);
    }

    if (nuevo_password && est.usuario_id) {
      db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(String(nuevo_password).trim(), est.usuario_id);
    }

    res.json({ success: true, mensaje: 'Contraseña y PIN escolar actualizados con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ENDPOINTS DE ADMINISTRACIÓN DE LA SODA
// ==========================================

// Métricas y Resumen Ejecutivo
app.get('/api/admin/resumen', (req, res) => {
  try {
    const ventasHoy = db.prepare(`
      SELECT COALESCE(SUM(total_colones), 0) as total, COUNT(*) as cantidad
      FROM ordenes 
      WHERE date(creado_en, 'localtime') = date('now', 'localtime')
    `).get();

    const statsEst = db.prepare(`
      SELECT 
        COUNT(*) as total_estudiantes,
        COALESCE(SUM(CASE WHEN tarjeta_bloqueada = 1 THEN 1 ELSE 0 END), 0) as tarjetas_bloqueadas,
        COALESCE(SUM(saldo_colones), 0) as saldo_total
      FROM estudiantes WHERE activo = 1
    `).get();

    const productosBajoStock = db.prepare(`
      SELECT COUNT(*) as count 
      FROM productos 
      WHERE control_stock = 1 AND (stock <= 3 OR disponible = 0)
    `).get().count;

    res.json({
      ventas_hoy: ventasHoy.total,
      ordenes_hoy: ventasHoy.cantidad,
      estudiantes_activos: statsEst.total_estudiantes,
      tarjetas_bloqueadas: statsEst.tarjetas_bloqueadas,
      saldo_total_estudiantes: statsEst.saldo_total,
      productos_bajo_stock: productosBajoStock
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listado de inventario para admin
app.get('/api/admin/productos', (req, res) => {
  try {
    const productos = db.prepare(`
      SELECT p.*, c.nombre as categoria_nombre, c.icono as categoria_icono
      FROM productos p
      JOIN categorias c ON p.categoria_id = c.id
      ORDER BY p.categoria_id, p.nombre
    `).all();
    res.json(productos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar stock y control
app.put('/api/admin/productos/:id/stock', (req, res) => {
  try {
    const { stock, control_stock, disponible, precio_colones } = req.body;
    const prodId = req.params.id;

    const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(prodId);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const nuevoStock = stock !== undefined ? parseInt(stock, 10) : prod.stock;
    const nuevoControl = control_stock !== undefined ? (control_stock ? 1 : 0) : prod.control_stock;
    const nuevoPrecio = precio_colones !== undefined ? parseInt(precio_colones, 10) : prod.precio_colones;
    
    let nuevoDisponible = disponible !== undefined ? (disponible ? 1 : 0) : prod.disponible;
    if (nuevoControl === 1 && nuevoStock <= 0) {
      nuevoDisponible = 0;
    } else if (nuevoControl === 1 && nuevoStock > 0 && disponible === undefined) {
      nuevoDisponible = 1;
    }

    db.prepare(`
      UPDATE productos 
      SET stock = ?, control_stock = ?, disponible = ?, precio_colones = ?
      WHERE id = ?
    `).run(nuevoStock, nuevoControl, nuevoDisponible, nuevoPrecio, prodId);

    const actualizado = db.prepare(`
      SELECT p.*, c.nombre as categoria_nombre, c.icono as categoria_icono
      FROM productos p
      JOIN categorias c ON p.categoria_id = c.id
      WHERE p.id = ?
    `).get(prodId);

    broadcastEvent('producto_actualizado', actualizado);
    res.json(actualizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ajuste rápido de stock (+5, +10, -1)
app.post('/api/admin/productos/:id/ajuste-rapido', (req, res) => {
  try {
    const { delta } = req.body;
    const prodId = req.params.id;

    const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(prodId);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const nuevoStock = Math.max(0, (prod.stock || 0) + parseInt(delta, 10));
    const nuevoDisponible = nuevoStock > 0 ? 1 : 0;

    db.prepare(`
      UPDATE productos 
      SET stock = ?, disponible = ?, control_stock = 1
      WHERE id = ?
    `).run(nuevoStock, nuevoDisponible, prodId);

    const actualizado = db.prepare(`
      SELECT p.*, c.nombre as categoria_nombre, c.icono as categoria_icono
      FROM productos p
      JOIN categorias c ON p.categoria_id = c.id
      WHERE p.id = ?
    `).get(prodId);

    broadcastEvent('producto_actualizado', actualizado);
    res.json(actualizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear nuevo estudiante + carné QR
app.post('/api/admin/estudiantes', (req, res) => {
  try {
    const { nombre_completo, edad, grado, seccion, saldo_inicial, limite_diario_colones, alergias, pin_seguridad, padre_nombre, padre_telefono } = req.body;

    if (!nombre_completo || !grado || !seccion) {
      return res.status(400).json({ error: 'Nombre completo, grado y sección son obligatorios' });
    }

    const count = db.prepare('SELECT COUNT(*) as count FROM estudiantes').get().count + 1;
    const codigoEstudiante = `EST-2026-${String(count).padStart(3, '0')}`;
    
    const primerNombre = nombre_completo.trim().split(' ')[0].toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const randomHex = Math.random().toString(16).substring(2, 6).toUpperCase();
    const qrToken = `QR-${primerNombre}-2026-${randomHex}`;

    const pin = pin_seguridad ? String(pin_seguridad).trim() : '1234';
    const saldo = parseInt(saldo_inicial, 10) || 0;
    const limite = parseInt(limite_diario_colones, 10) || 3000;
    const edadNum = parseInt(edad, 10) || 8;
    const foto = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(primerNombre)}&backgroundColor=b6e3f4`;

    const resEst = db.prepare(`
      INSERT INTO estudiantes 
      (codigo_estudiante, nombre_completo, edad, grado, seccion, qr_token, pin_seguridad, foto_url, saldo_colones, limite_diario_colones, alergias, padre_nombre, padre_telefono, permitir_transferencias, tarjeta_bloqueada, activo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1)
    `).run(
      codigoEstudiante,
      nombre_completo.trim(),
      edadNum,
      grado.trim(),
      seccion.trim(),
      qrToken,
      pin,
      foto,
      saldo,
      limite,
      alergias || 'Ninguna conocida',
      padre_nombre || '',
      padre_telefono || ''
    );

    const nuevoId = resEst.lastInsertRowid;

    // Crear cuenta de usuario estudiante
    const usernameEst = primerNombre.toLowerCase() + count;
    try {
      const userRes = db.prepare(`
        INSERT INTO usuarios (username, password_hash, rol, nombre, email, telefono)
        VALUES (?, ?, 'estudiante', ?, '', '')
      `).run(usernameEst, pin, nombre_completo.trim());
      db.prepare('UPDATE estudiantes SET usuario_id = ? WHERE id = ?').run(userRes.lastInsertRowid, nuevoId);
    } catch (e) {}

    // Si tiene saldo inicial, registrar en movimientos
    if (saldo > 0) {
      db.prepare(`
        INSERT INTO transacciones_saldo 
        (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, descripcion)
        VALUES (?, 'recarga_manual', ?, 0, ?, 'Saldo inicial asignado por administración')
      `).run(nuevoId, saldo, saldo);
    }

    const creado = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(nuevoId);
    broadcastEvent('estudiante_creado', creado);

    res.status(201).json(creado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bloquear / Desbloquear tarjeta de estudiante
app.put('/api/admin/estudiantes/:id/bloquear', (req, res) => {
  try {
    const { tarjeta_bloqueada } = req.body;
    const estId = req.params.id;

    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estId);
    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado' });

    const nuevoEstado = tarjeta_bloqueada ? 1 : 0;
    db.prepare('UPDATE estudiantes SET tarjeta_bloqueada = ? WHERE id = ?').run(nuevoEstado, estId);

    const actualizado = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estId);
    broadcastEvent('estudiante_actualizado', actualizado);

    res.json(actualizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recarga manual de saldo en efectivo/soda
app.post('/api/admin/estudiantes/:id/recarga-manual', (req, res) => {
  try {
    const { monto, descripcion, metodo } = req.body;
    const estudianteId = parseInt(req.params.id, 10);
    const montoColones = parseInt(monto, 10);

    if (isNaN(montoColones) || montoColones <= 0) {
      return res.status(400).json({ error: 'El monto a cargar debe ser mayor a ₡0' });
    }

    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estudianteId);
    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado' });

    const nuevoSaldo = est.saldo_colones + montoColones;
    db.prepare('UPDATE estudiantes SET saldo_colones = ? WHERE id = ?').run(nuevoSaldo, estudianteId);

    const descFinal = descripcion || `Carga en efectivo en la soda escolar (${metodo || 'Caja'})`;

    db.prepare(`
      INSERT INTO transacciones_saldo 
      (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, comprobante_sinpe, descripcion)
      VALUES (?, 'recarga_manual', ?, ?, ?, 'CAJA-SODA', ?)
    `).run(estudianteId, montoColones, est.saldo_colones, nuevoSaldo, descFinal);

    const resultado = {
      exito: true,
      estudiante_id: est.id,
      nombre: est.nombre_completo,
      monto: montoColones,
      saldo_anterior: est.saldo_colones,
      saldo_nuevo: nuevoSaldo,
      mensaje: `¡Se cargaron ₡${montoColones.toLocaleString('es-CR')} al monedero de ${est.nombre_completo}!`
    };

    broadcastEvent('recarga_exitosa', resultado);
    broadcastEvent('estudiante_actualizado', { id: est.id, estudiante_id: est.id, saldo_colones: nuevoSaldo });
    broadcastEvent('saldo_actualizado', { id: est.id, estudiante_id: est.id, saldo_colones: nuevoSaldo });
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 1. ESTUDIANTES Y QR
// ==========================================

// Listar todos los estudiantes
app.get('/api/estudiantes', (req, res) => {
  try {
    const list = db.prepare(`
      SELECT e.*, 
        COALESCE((
          SELECT SUM(ABS(monto_colones)) 
          FROM transacciones_saldo 
          WHERE estudiante_id = e.id AND monto_colones < 0 
            AND date(fecha, 'localtime') = date('now', 'localtime')
        ), 0) as gastado_hoy
      FROM estudiantes e 
      WHERE activo = 1 
      ORDER BY grado, seccion, nombre_completo
    `).all();
    const listWithDisp = list.map(e => ({
      ...e,
      disponible_hoy: Math.max(0, (e.limite_diario_colones || 0) - (e.gastado_hoy || 0))
    }));
    res.json(listWithDisp);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener estudiante por ID con historial
app.get('/api/estudiantes/:id', (req, res) => {
  try {
    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(req.params.id);
    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado' });

    // Gastado hoy
    const gastoHoy = db.prepare(`
      SELECT COALESCE(SUM(ABS(monto_colones)), 0) as total
      FROM transacciones_saldo
      WHERE estudiante_id = ? AND monto_colones < 0 AND date(fecha, 'localtime') = date('now', 'localtime')
    `).get(est.id).total;

    // Transacciones recientes
    const transacciones = db.prepare(`
      SELECT * FROM transacciones_saldo 
      WHERE estudiante_id = ? 
      ORDER BY fecha DESC LIMIT 20
    `).all(est.id);

    // Órdenes activas
    const ordenesActivas = db.prepare(`
      SELECT * FROM ordenes 
      WHERE estudiante_id = ? AND estado IN ('pendiente', 'en_preparacion', 'listo')
      ORDER BY creado_en DESC
    `).all(est.id);

    res.json({
      ...est,
      gastado_hoy: gastoHoy,
      disponible_hoy: Math.max(0, est.limite_diario_colones - gastoHoy),
      transacciones,
      ordenes_activas: ordenesActivas
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Buscar estudiante por código QR (Ultra rápido para terminal de caja)
app.get('/api/estudiantes/qr/:token', (req, res) => {
  try {
    const { token } = req.params;
    const cleanToken = String(token).trim();
    const est = db.prepare('SELECT * FROM estudiantes WHERE qr_token = ? OR codigo_estudiante = ? OR LOWER(codigo_estudiante) = LOWER(?)').get(cleanToken, cleanToken, cleanToken);
    if (!est) {
      return res.status(404).json({ error: 'Código QR no reconocido en la base de datos de la escuela' });
    }

    const gastoHoy = db.prepare(`
      SELECT COALESCE(SUM(ABS(monto_colones)), 0) as total
      FROM transacciones_saldo
      WHERE estudiante_id = ? AND monto_colones < 0 AND date(fecha, 'localtime') = date('now', 'localtime')
    `).get(est.id).total;

    // Verificar si tiene pre-órdenes listas para retirar en el recreo
    const preordenesPendientes = db.prepare(`
      SELECT o.*, 
        (SELECT json_group_array(json_object('nombre', p.nombre, 'cantidad', d.cantidad, 'precio', d.precio_unitario))
         FROM orden_detalles d JOIN productos p ON d.producto_id = p.id WHERE d.orden_id = o.id) as items_json
      FROM ordenes o
      WHERE o.estudiante_id = ? AND o.tipo_orden = 'preorden' AND o.estado IN ('pendiente', 'en_preparacion', 'listo')
      ORDER BY o.creado_en ASC
    `).all(est.id);

    const preordenesFormateadas = preordenesPendientes.map(o => ({
      ...o,
      items: JSON.parse(o.items_json || '[]')
    }));

    res.json({
      ...est,
      gastado_hoy: gastoHoy,
      disponible_hoy: Math.max(0, est.limite_diario_colones - gastoHoy),
      preordenes_pendientes: preordenesFormateadas
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generar imagen QR en PNG/SVG para el carné
app.get('/api/qr-image/:token', async (req, res) => {
  try {
    const qrDataUrl = await QRCode.toDataURL(req.params.token, {
      width: 300,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
    const imgBuffer = Buffer.from(base64Data, 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': imgBuffer.length
    });
    res.end(imgBuffer);
  } catch (error) {
    res.status(500).send('Error generando QR');
  }
});

// Recarga de saldo (SINPE Móvil)
app.post('/api/estudiantes/:id/recarga', (req, res) => {
  try {
    const { monto, comprobante, descripcion } = req.body;
    const estudianteId = parseInt(req.params.id, 10);

    const resultado = recargaSaldoTransaction({
      estudianteId,
      monto: parseInt(monto, 10),
      comprobanteSinpe: comprobante || 'SINPE-MÓVIL',
      descripcion: descripcion || `Recarga SINPE de ₡${parseInt(monto, 10).toLocaleString('es-CR')}`
    });

    broadcastEvent('recarga_exitosa', resultado);
    broadcastEvent('estudiante_actualizado', { id: estudianteId, estudiante_id: estudianteId, saldo_colones: resultado.saldo_nuevo });
    broadcastEvent('saldo_actualizado', { id: estudianteId, estudiante_id: estudianteId, saldo_colones: resultado.saldo_nuevo });
    res.json(resultado);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Actualizar configuración parental (Límite diario, restricciones y transferencias P2P)
app.put('/api/estudiantes/:id/limite', (req, res) => {
  try {
    const { limite_diario_colones, alergias, bloquear_chucherias, permitir_transferencias } = req.body;
    const estId = req.params.id;

    db.prepare(`
      UPDATE estudiantes 
      SET limite_diario_colones = COALESCE(?, limite_diario_colones),
          alergias = COALESCE(?, alergias),
          bloquear_chucherias = COALESCE(?, bloquear_chucherias),
          permitir_transferencias = COALESCE(?, permitir_transferencias)
      WHERE id = ?
    `).run(limite_diario_colones, alergias, bloquear_chucherias, permitir_transferencias, estId);

    const actualizado = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estId);
    if (actualizado) {
      const gastoHoy = db.prepare(`
        SELECT COALESCE(SUM(ABS(monto_colones)), 0) as total
        FROM transacciones_saldo
        WHERE estudiante_id = ? AND monto_colones < 0 AND date(fecha, 'localtime') = date('now', 'localtime')
      `).get(estId).total;
      actualizado.gastado_hoy = gastoHoy;
      actualizado.disponible_hoy = Math.max(0, (actualizado.limite_diario_colones || 0) - gastoHoy);
      broadcastEvent('estudiante_actualizado', actualizado);
    }
    res.json(actualizado);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Transferencia P2P entre estudiantes (Opción 2: Escaneo directo del compañero)
app.post('/api/transferencias', (req, res) => {
  try {
    const { emisor_id, qr_receptor, receptor_id, monto, pin, motivo } = req.body;
    if (!emisor_id) return res.status(400).json({ error: 'Emisor no especificado' });

    const resultado = transferenciaP2PTransaction({
      emisorId: parseInt(emisor_id, 10),
      qrReceptor: qr_receptor,
      receptorId: receptor_id ? parseInt(receptor_id, 10) : null,
      monto: parseInt(monto, 10),
      pin,
      motivo
    });

    // Notificar en tiempo real por SSE
    broadcastEvent('transferencia_realizada', resultado);
    if (resultado.emisor) {
      broadcastEvent('estudiante_actualizado', { id: resultado.emisor.id, estudiante_id: resultado.emisor.id, saldo_colones: resultado.emisor.saldo_nuevo });
    }
    if (resultado.receptor) {
      broadcastEvent('estudiante_actualizado', { id: resultado.receptor.id, estudiante_id: resultado.receptor.id, saldo_colones: resultado.receptor.saldo_nuevo });
    }

    res.json(resultado);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// 2. PRODUCTOS Y MENÚ
// ==========================================

app.get('/api/productos', (req, res) => {
  try {
    const categorias = db.prepare('SELECT * FROM categorias ORDER BY orden ASC').all();
    const productos = db.prepare(`
      SELECT p.*, c.nombre as categoria_nombre, c.icono as categoria_icono
      FROM productos p
      JOIN categorias c ON p.categoria_id = c.id
      ORDER BY p.categoria_id, p.nombre
    `).all();

    res.json({ categorias, productos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 3. ÓRDENES (MOSTRADOR Y PRE-ÓRDENES)
// ==========================================

// Crear orden (compra con QR o pre-orden)
app.post('/api/ordenes', (req, res) => {
  try {
    const { estudiante_id, qr_token, tipo_orden, momento_entrega, notas, items } = req.body;

    let targetEstudianteId = estudiante_id;
    if (!targetEstudianteId && qr_token) {
      const est = db.prepare('SELECT id FROM estudiantes WHERE qr_token = ? OR codigo_estudiante = ?').get(qr_token, qr_token);
      if (!est) return res.status(404).json({ error: 'Estudiante no encontrado por código QR' });
      targetEstudianteId = est.id;
    }

    if (!targetEstudianteId) {
      return res.status(400).json({ error: 'Debe especificar el estudiante o escanear su código QR' });
    }

    const resultado = crearOrdenCompleta({
      estudianteId: targetEstudianteId,
      tipoOrden: tipo_orden || 'mostrador',
      momentoEntrega: momento_entrega || 'inmediato',
      notas,
      items
    });

    // Notificar en tiempo real a la pantalla de cocina/caja de la soda
    broadcastEvent('nueva_orden', resultado);

    // Notificar actualización de estudiante (saldo y disponible) en tiempo real a clientes
    if (resultado && resultado.financiero && resultado.financiero.estudiante) {
      const fEst = resultado.financiero.estudiante;
      const payloadActualizacion = {
        id: targetEstudianteId,
        estudiante_id: targetEstudianteId,
        saldo_colones: fEst.saldo_nuevo,
        gastado_hoy: fEst.gastado_hoy,
        disponible_hoy: (typeof fEst.disponible_hoy === 'number') 
          ? fEst.disponible_hoy 
          : Math.max(0, (fEst.limite_diario || 0) - (fEst.gastado_hoy || 0)),
        orden: resultado
      };
      broadcastEvent('estudiante_actualizado', payloadActualizacion);
      broadcastEvent('saldo_actualizado', payloadActualizacion);
    }

    res.status(201).json(resultado);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Listar órdenes (con filtro por estado o tipo)
app.get('/api/ordenes', (req, res) => {
  try {
    const { estado, tipo, estudiante_id } = req.query;
    let query = `
      SELECT o.*, e.nombre_completo as estudiante_nombre, e.grado, e.seccion, e.foto_url,
        (SELECT json_group_array(json_object('producto_id', p.id, 'nombre', p.nombre, 'icono', p.icono, 'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario, 'subtotal', d.subtotal))
         FROM orden_detalles d JOIN productos p ON d.producto_id = p.id WHERE d.orden_id = o.id) as items_json
      FROM ordenes o
      JOIN estudiantes e ON o.estudiante_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (estudiante_id) {
      query += ' AND o.estudiante_id = ?';
      params.push(estudiante_id);
    }
    if (estado) {
      query += ' AND o.estado = ?';
      params.push(estado);
    }
    if (tipo) {
      query += ' AND o.tipo_orden = ?';
      params.push(tipo);
    }

    query += ' ORDER BY o.creado_en DESC LIMIT 50';

    const ordenes = db.prepare(query).all(...params);
    const resultado = ordenes.map(o => ({
      ...o,
      items: JSON.parse(o.items_json || '[]')
    }));

    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar estado de una orden (Cocina -> Listo -> Entregado)
app.put('/api/ordenes/:id/estado', (req, res) => {
  try {
    const { estado } = req.body;
    const ordenId = req.params.id;

    const entregadoEn = estado === 'entregado' ? new Date().toISOString() : null;

    db.prepare(`
      UPDATE ordenes 
      SET estado = ?, entregado_en = COALESCE(?, entregado_en)
      WHERE id = ?
    `).run(estado, entregadoEn, ordenId);

    const actualizada = db.prepare('SELECT * FROM ordenes WHERE id = ?').get(ordenId);
    broadcastEvent('orden_actualizada', actualizada);

    res.json(actualizada);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Despacho ultra-rápido en fila de pre-órdenes mediante escaneo de QR
app.post('/api/ordenes/despachar-qr', (req, res) => {
  try {
    const { qr_token } = req.body;
    if (!qr_token) return res.status(400).json({ error: 'Se requiere el código QR del estudiante' });

    const est = db.prepare('SELECT * FROM estudiantes WHERE qr_token = ? OR codigo_estudiante = ?').get(qr_token, qr_token);
    if (!est) return res.status(404).json({ error: 'Estudiante no identificado' });

    // Buscar la pre-orden más prioritaria lista o pendiente para entrega
    const preorden = db.prepare(`
      SELECT * FROM ordenes 
      WHERE estudiante_id = ? AND tipo_orden = 'preorden' AND estado IN ('listo', 'pendiente', 'en_preparacion')
      ORDER BY creado_en ASC LIMIT 1
    `).get(est.id);

    if (!preorden) {
      return res.status(404).json({
        error: `No hay pre-órdenes pendientes de retiro para ${est.nombre_completo} en este recreo.`
      });
    }

    // Marcar como entregada
    db.prepare("UPDATE ordenes SET estado = 'entregado', entregado_en = datetime('now', 'localtime') WHERE id = ?").run(preorden.id);

    // Obtener detalles para mostrar en pantalla de caja
    const items = db.prepare(`
      SELECT p.nombre, p.icono, d.cantidad, d.subtotal
      FROM orden_detalles d
      JOIN productos p ON d.producto_id = p.id
      WHERE d.orden_id = ?
    `).all(preorden.id);

    const responseData = {
      exito: true,
      mensaje: `¡Pre-orden ${preorden.codigo_orden} despachada con éxito!`,
      estudiante: est,
      orden: {
        id: preorden.id,
        codigo: preorden.codigo_orden,
        momento_entrega: preorden.momento_entrega,
        total: preorden.total_colones,
        items
      }
    };

    broadcastEvent('orden_despachada', responseData);
    res.json(responseData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Información de conectividad y túnel HTTPS
app.get('/api/server-info', (req, res) => {
  res.json({
    tunnelUrl: process.env.TUNNEL_URL || 'https://somewhat-ships-looksmart-optical.trycloudflare.com',
    httpsAvailable: true
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor RecreoPay iniciado en http://localhost:${PORT}`);
  console.log(`📱 PWA Estudiantes/Padres: http://localhost:${PORT}/index.html`);
  console.log(`📟 Terminal Soda/Escáner QR: http://localhost:${PORT}/pos.html`);
  console.log(`🖨️ Generador de Carnés Físicos: http://localhost:${PORT}/carnet.html`);
});
