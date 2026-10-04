const express = require('express');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const { db, initDatabase, debitoCompraTransaction, recargaSaldoTransaction, crearOrdenCompleta } = require('./db');

const app = express();
const PORT = process.env.PORT || 3030;

// Initialize DB schema & seed data
initDatabase();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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
            AND date(fecha) = date('now', 'localtime')
        ), 0) as gastado_hoy
      FROM estudiantes e 
      WHERE activo = 1 
      ORDER BY grado, seccion, nombre_completo
    `).all();
    res.json(list);
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
      WHERE estudiante_id = ? AND monto_colones < 0 AND date(fecha) = date('now', 'localtime')
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
    const est = db.prepare('SELECT * FROM estudiantes WHERE qr_token = ? OR codigo_estudiante = ?').get(token, token);
    if (!est) {
      return res.status(404).json({ error: 'Código QR no reconocido en la base de datos de la escuela' });
    }

    const gastoHoy = db.prepare(`
      SELECT COALESCE(SUM(ABS(monto_colones)), 0) as total
      FROM transacciones_saldo
      WHERE estudiante_id = ? AND monto_colones < 0 AND date(fecha) = date('now', 'localtime')
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
    res.json(resultado);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Actualizar configuración parental (Límite diario y restricciones)
app.put('/api/estudiantes/:id/limite', (req, res) => {
  try {
    const { limite_diario_colones, alergias, bloquear_chucherias } = req.body;
    const estId = req.params.id;

    db.prepare(`
      UPDATE estudiantes 
      SET limite_diario_colones = COALESCE(?, limite_diario_colones),
          alergias = COALESCE(?, alergias),
          bloquear_chucherias = COALESCE(?, bloquear_chucherias)
      WHERE id = ?
    `).run(limite_diario_colones, alergias, bloquear_chucherias, estId);

    const actualizado = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estId);
    res.json(actualizado);
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
      WHERE p.disponible = 1
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

    res.status(201).json(resultado);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Listar órdenes (con filtro por estado o tipo)
app.get('/api/ordenes', (req, res) => {
  try {
    const { estado, tipo } = req.query;
    let query = `
      SELECT o.*, e.nombre_completo as estudiante_nombre, e.grado, e.seccion, e.foto_url,
        (SELECT json_group_array(json_object('producto_id', p.id, 'nombre', p.nombre, 'icono', p.icono, 'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario, 'subtotal', d.subtotal))
         FROM orden_detalles d JOIN productos p ON d.producto_id = p.id WHERE d.orden_id = o.id) as items_json
      FROM ordenes o
      JOIN estudiantes e ON o.estudiante_id = e.id
      WHERE 1=1
    `;
    const params = [];

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

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor RecreoPay iniciado en http://localhost:${PORT}`);
  console.log(`📱 PWA Estudiantes/Padres: http://localhost:${PORT}/index.html`);
  console.log(`📟 Terminal Soda/Escáner QR: http://localhost:${PORT}/pos.html`);
  console.log(`🖨️ Generador de Carnés Físicos: http://localhost:${PORT}/carnet.html`);
});
