const path = require('path');
const fs = require('fs');

// Cargar variables de entorno de .env nativamente
try {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
} catch (e) {}

const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const { 
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
  eliminarSuscripcionPush,
  formatMomentoLabel,
  expirarPreordenesVencidas,
  cancelarPreorden,
  despacharPreordenTransaction,
  enriquecerEstudianteFinanzas,
  obtenerHorariosEscuela,
  actualizarHorariosEscuela,
  formatTime12h,
  buscarSinpeUniversalDev,
  forzarAprobarSolicitudDev,
  rechazarSolicitudDev,
  vincularBancoAEstudianteDev
} = require('./db');
const { checkSinpeEmailsOnce, simularSinpeEmail } = require('./sinpeImapService');
const { normalizarCodigoDetalle, parseSinpeEmail } = require('./sinpeParser');
const { simpleParser } = require('mailparser');

const webpush = require('web-push');

// Configuración VAPID para Web Push en Segundo Plano (App Cerrada en iOS / Android)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BDHXXfRHdftR2qg-WV5Trz85t8hIllB7_gBdfKut747-XihlnbQgstbMc94P5SR4vGUWgKE_mE9WClaRc-Lp060';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'ufOrxmh5a2ouxonOyue-ZSQJPWMN0dq6CkbDYErgZaw';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:soporte@sibopay.cr';

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('🔔 VAPID Web Push configurado correctamente');
} catch (e) {
  console.warn('⚠️ Error configurando VAPID Web Push:', e.message);
}

async function sendWebPushNotification({ escuelaId = null, payload, roles = ['admin', 'soda', 'cajero', 'developer'] } = {}) {
  try {
    const subs = obtenerSuscripcionesPush({ escuelaId, roles });
    if (!subs || subs.length === 0) return;

    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

    const promises = subs.map(async (sub) => {
      const pushConfig = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };

      try {
        await webpush.sendNotification(pushConfig, payloadString);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          console.log('[WebPush] Suscripción expirada o removida, eliminando:', sub.endpoint);
          eliminarSuscripcionPush(sub.endpoint);
        } else {
          console.warn('[WebPush] Aviso al enviar notificación:', err.message);
        }
      }
    });

    await Promise.allSettled(promises);
  } catch (error) {
    console.error('[WebPush] Error general en sendWebPushNotification:', error);
  }
}

const compression = require('compression');
const app = express();
const PORT = process.env.PORT || 3030;

// ==========================================
// MÓDULO: TERMINAL WEB Y LOGS EN VIVO (DEVELOPER)
// ==========================================
const MAX_SERVER_LOGS = 600;
const serverLogsBuffer = [];
const devLogClients = new Set();
let logSequenceId = 1;

function pushServerLog(level, tag, rawMessage, details = null) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const padMs = (n) => String(n).padStart(3, '0');
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${padMs(now.getMilliseconds())}`;
  
  const msgStr = typeof rawMessage === 'string' ? rawMessage : JSON.stringify(rawMessage);
  
  const logEntry = {
    id: logSequenceId++,
    timestamp: timeStr,
    isoTime: now.toISOString(),
    level: level || 'info', // 'info' | 'warn' | 'error' | 'http' | 'sinpe'
    tag: tag || 'APP',
    message: msgStr.trim(),
    details: details ? String(details) : null
  };

  serverLogsBuffer.push(logEntry);
  if (serverLogsBuffer.length > MAX_SERVER_LOGS) {
    serverLogsBuffer.shift();
  }

  if (devLogClients.size > 0) {
    const sseMsg = `event: server_log\ndata: ${JSON.stringify(logEntry)}\n\n`;
    for (const client of devLogClients) {
      try {
        client.write(sseMsg);
        if (typeof client.flush === 'function') client.flush();
      } catch (e) {
        devLogClients.delete(client);
      }
    }
  }
}

// Interceptores de consola seguros (sin recursión)
const origConsoleLog = console.log;
const origConsoleWarn = console.warn;
const origConsoleError = console.error;

console.log = function(...args) {
  origConsoleLog.apply(console, args);
  try {
    const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    let tag = 'APP';
    let level = 'info';
    if (text.includes('[SINPE')) { tag = 'SINPE'; }
    else if (text.includes('[WebPush')) { tag = 'WEBPUSH'; }
    else if (text.includes('[PISTOLA')) { tag = 'PISTOLA'; }
    else if (text.includes('[Seguridad')) { tag = 'AUTH'; }
    else if (text.includes('[AUTO-EXPIRACION')) { tag = 'CRON'; }
    pushServerLog(level, tag, text);
  } catch (e) {}
};

console.warn = function(...args) {
  origConsoleWarn.apply(console, args);
  try {
    const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    pushServerLog('warn', 'WARN', text);
  } catch (e) {}
};

console.error = function(...args) {
  origConsoleError.apply(console, args);
  try {
    const text = args.map(a => (typeof a === 'object' ? (a && a.stack ? a.stack : JSON.stringify(a)) : String(a))).join(' ');
    pushServerLog('error', 'ERROR', text);
  } catch (e) {}
};

// Cargar historial previo de PM2 si existe en el servidor
try {
  const pm2LogPath = '/root/.pm2/logs/recreopay-out.log';
  if (fs.existsSync(pm2LogPath)) {
    const rawContent = fs.readFileSync(pm2LogPath, 'utf8');
    const recentLines = rawContent.split('\n').filter(Boolean).slice(-40);
    for (const line of recentLines) {
      let tag = 'PM2';
      if (line.includes('[SINPE')) tag = 'SINPE';
      pushServerLog('info', tag, line);
    }
  }
} catch (e) {}

pushServerLog('info', 'SISTEMA', `Terminal Web inicializada (Node ${process.version}, PID ${process.pid})`);

// Compresión Gzip de alto rendimiento para HTML, JS, CSS y JSON
app.use(compression());

// Middleware de trazabilidad de peticiones HTTP en tiempo real para la terminal
app.use((req, res, next) => {
  const p = req.path || '';
  if (p === '/api/events' || p === '/api/developer/logs/stream' || p.startsWith('/css/') || p.startsWith('/js/') || p.startsWith('/img/') || p.endsWith('.png') || p.endsWith('.ico') || p.endsWith('.json')) {
    return next();
  }
  
  if (p.startsWith('/api/')) {
    const start = Date.now();
    const method = req.method;
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      let level = 'http';
      let tag = 'HTTP';
      if (status >= 500) { level = 'error'; }
      else if (status >= 400) { level = 'warn'; }
      
      if (p.includes('/sinpe/')) { tag = 'SINPE'; }
      else if (p.includes('/ordenes') || p.includes('/pos')) { tag = 'ORDEN'; }
      else if (p.includes('/login') || p.includes('/auth')) { tag = 'AUTH'; }
      else if (p.includes('/developer/')) { tag = 'DEV'; }
      
      pushServerLog(level, tag, `${method} ${p} -> ${status} (${duration}ms)`);
    });
  }
  next();
});

// Initialize DB schema & seed data
initDatabase();

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Landing page principal de SiboPay (donde está toda la información y presentación)
app.get(['/', '/landing', '/presentacion', '/info'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/desktop-preview.html'));
});

// Aplicación oficial de SiboPay / Pantalla de Inicio de Sesión
app.get(['/app', '/login', '/portal', '/ingresar'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Redirección limpia de /desktop-preview.html a la raíz
app.get('/desktop-preview.html', (req, res) => {
  res.redirect(301, '/');
});

// Android Digital Asset Links para TWA (Google Play Store)
const assetlinksPath = path.join(__dirname, '../public/.well-known/assetlinks.json');
let assetlinksContent = '[]';
try {
  assetlinksContent = fs.readFileSync(assetlinksPath, 'utf8');
} catch (e) {}

app.use((req, res, next) => {
  if (req.path === '/.well-known/assetlinks.json' || req.path === '/.well-known/assetlinks') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(assetlinksContent);
  }
  next();
});

// Servir archivos estáticos con compresión y caché optimizado para PWA
app.use(express.static(path.join(__dirname, '../public'), {
  dotfiles: 'allow',
  etag: true,
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    // Para HTML y Service Worker: siempre revalidar para garantizar actualizaciones inmediatas
    if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.json') || filePath.includes('assetlinks.json')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      // Para CSS, JS, imágenes y fuentes: permitir caché con stale-while-revalidate para arranque instantáneo
      res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    }
  }
}));

// Simple in-memory SSE clients for real-time notifications
const sseClients = new Set();

function broadcastEvent(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
      if (typeof client.flush === 'function') client.flush();
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// SSE stream for real-time soda screen and student apps
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Enviar handshake inmediato para confirmar conexión abierta sin buffering
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Heartbeat cada 10 segundos para mantener vivas las conexiones móviles / proxies
setInterval(() => {
  const ping = ': ping\n\n';
  for (const client of sseClients) {
    try {
      client.write(ping);
      if (typeof client.flush === 'function') client.flush();
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 10000);

// ==========================================
// PISTOLA REMOTA QR / HANDHELD SMARTPHONE
// ==========================================

// Disparo remoto desde la pistola móvil (teléfono) hacia la caja POS
app.post('/api/pos/remote-scan', (req, res) => {
  try {
    const { token, deviceName, escuela_id } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    console.log(`📡 [PISTOLA REMOTA] Disparo recibido desde ${deviceName || 'teléfono'}: ${token}`);

    // Broadcast a todas las terminales POS conectadas por SSE
    broadcastEvent('pistola_scan', {
      token: String(token).trim(),
      deviceName: deviceName || 'Pistola Teléfono',
      escuela_id: escuela_id ? parseInt(escuela_id, 10) : null,
      timestamp: Date.now()
    });

    res.json({ ok: true, token: String(token).trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Solicitud desde el POS en PC al teléfono para avisar que la caja está lista para cobrar
app.post('/api/pos/notify-scan-ready', (req, res) => {
  try {
    const { mode, total, itemsCount } = req.body;
    broadcastEvent('pistola_solicitud_cobro', {
      mode: mode || 'cobro',
      total: total || 0,
      itemsCount: itemsCount || 0,
      timestamp: Date.now()
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancelación de solicitud cuando se cierra el modal de cobro en la PC
app.post('/api/pos/notify-scan-cancel', (req, res) => {
  try {
    broadcastEvent('pistola_cancelar_cobro', { timestamp: Date.now() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

    if (user.activo === 0) {
      return res.status(403).json({ error: 'Tu cuenta ha sido bloqueada por la administración.' });
    }

    let estudiante = null;
    let hijos = [];
    let escuela = null;

    if (user.escuela_id) {
      try {
        escuela = db.prepare('SELECT id, codigo, nombre, telefono_sinpe, nombre_sinpe, concesionario FROM escuelas WHERE id = ?').get(user.escuela_id);
      } catch (e) {}
    }

    if (user.rol === 'estudiante') {
      estudiante = db.prepare(`
        SELECT e.*, esc.nombre as escuela_nombre, esc.codigo as escuela_codigo, esc.telefono_sinpe, esc.nombre_sinpe
        FROM estudiantes e
        LEFT JOIN escuelas esc ON esc.id = e.escuela_id
        WHERE e.usuario_id = ?
      `).get(user.id);
      if (!estudiante) {
        let sqlEst = `
          SELECT e.*, esc.nombre as escuela_nombre, esc.codigo as escuela_codigo, esc.telefono_sinpe, esc.nombre_sinpe
          FROM estudiantes e
          LEFT JOIN escuelas esc ON esc.id = e.escuela_id
          WHERE (LOWER(e.codigo_estudiante) = ? OR LOWER(e.nombre_completo) LIKE ?)
        `;
        const paramsEst = [cleanUser, `%${cleanUser}%`];
        if (user.escuela_id) {
          sqlEst += ' AND e.escuela_id = ?';
          paramsEst.push(user.escuela_id);
        }
        estudiante = db.prepare(sqlEst).get(...paramsEst);
      }
      if (estudiante) {
        estudiante = enriquecerEstudianteFinanzas(estudiante);
      }
    } else if (user.rol === 'padre') {
      hijos = db.prepare(`
        SELECT e.*, esc.nombre as escuela_nombre, esc.codigo as escuela_codigo, esc.telefono_sinpe, esc.nombre_sinpe
        FROM estudiantes e
        LEFT JOIN escuelas esc ON esc.id = e.escuela_id
        JOIN padres_estudiantes pe ON e.id = pe.estudiante_id
        WHERE pe.padre_usuario_id = ?
        ORDER BY e.nombre_completo ASC
      `).all(user.id);
      if (hijos.length === 0) {
        hijos = db.prepare(`
          SELECT e.*, esc.nombre as escuela_nombre, esc.codigo as escuela_codigo, esc.telefono_sinpe, esc.nombre_sinpe
          FROM estudiantes e
          LEFT JOIN escuelas esc ON esc.id = e.escuela_id
          WHERE e.padre_usuario_id = ?
        `).all(user.id);
      }
      hijos = hijos.map(h => enriquecerEstudianteFinanzas(h));
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        rol: user.rol,
        nombre: user.nombre,
        email: user.email,
        telefono: user.telefono,
        escuela_id: user.escuela_id || 1,
        escuela: escuela
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

// ==========================================
// ELIMINACIÓN DE CUENTA Y SUPRESIÓN DE DATOS (GOOGLE PLAY & APPLE COMPLIANCE)
// ==========================================
app.post('/api/auth/eliminar-cuenta', (req, res) => {
  try {
    const { usuario_id, password_confirmacion, motivo } = req.body;
    if (!usuario_id) {
      return res.status(400).json({ error: 'ID de usuario requerido para procesar la baja' });
    }

    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuario_id);
    if (!user) {
      return res.status(404).json({ error: 'La cuenta de usuario no existe o ya ha sido eliminada' });
    }

    // Verificar contraseña si fue enviada (o frase de confirmación ELIMINAR)
    if (password_confirmacion) {
      const cleanPass = String(password_confirmacion).trim();
      if (cleanPass !== user.password_hash && cleanPass.toUpperCase() !== 'ELIMINAR') {
        return res.status(401).json({ error: 'Contraseña de confirmación incorrecta. Por favor verifícala para proceder con el borrado.' });
      }
    }

    // Proceder con el borrado y disociación según el rol
    if (user.rol === 'padre') {
      // 1. Desvincular de todos los hijos en tabla de enlace
      db.prepare('DELETE FROM padres_estudiantes WHERE padre_usuario_id = ?').run(user.id);
      // 2. Desvincular campo legacy en estudiantes
      db.prepare('UPDATE estudiantes SET padre_usuario_id = NULL WHERE padre_usuario_id = ?').run(user.id);
    } else if (user.rol === 'estudiante') {
      // 3. Desvincular usuario de su ficha de estudiante
      db.prepare('UPDATE estudiantes SET usuario_id = NULL WHERE usuario_id = ?').run(user.id);
    }

    // 4. Limpiar tokens de notificaciones push asociados a este usuario
    try {
      if (user.id) {
        db.prepare('DELETE FROM push_subscriptions WHERE usuario_id = ?').run(user.id);
      }
    } catch (e) {}

    // 5. Eliminar registro del usuario en tabla usuarios
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(user.id);

    console.log(`[Seguridad] Cuenta eliminada: ID=${user.id}, Usuario=${user.username}, Rol=${user.rol}, Motivo=${motivo || 'No especificado'}`);

    res.json({
      success: true,
      mensaje: 'Tu cuenta y datos personales han sido eliminados de forma definitiva de SiboPay.'
    });
  } catch (err) {
    console.error('[Error eliminar cuenta]:', err);
    res.status(500).json({ error: 'Error procesando la eliminación: ' + err.message });
  }
});

// Solicitud pública de eliminación de cuenta desde web (Requisito Google Play Console)
app.post('/api/public/solicitar-eliminacion-cuenta', (req, res) => {
  try {
    const { identificador, motivo, confirmacion } = req.body;
    if (!identificador) {
      return res.status(400).json({ error: 'Por favor ingresa tu nombre de usuario, correo electrónico o teléfono registrado.' });
    }

    const cleanId = String(identificador).trim().toLowerCase();
    const user = db.prepare(`
      SELECT id, username, rol, email, telefono FROM usuarios 
      WHERE LOWER(username) = ? OR LOWER(email) = ? OR telefono = ?
    `).get(cleanId, cleanId, cleanId);

    if (user) {
      if (confirmacion === true || String(confirmacion).toUpperCase() === 'ELIMINAR') {
        if (user.rol === 'padre') {
          db.prepare('DELETE FROM padres_estudiantes WHERE padre_usuario_id = ?').run(user.id);
          db.prepare('UPDATE estudiantes SET padre_usuario_id = NULL WHERE padre_usuario_id = ?').run(user.id);
        } else if (user.rol === 'estudiante') {
          db.prepare('UPDATE estudiantes SET usuario_id = NULL WHERE usuario_id = ?').run(user.id);
        }
        db.prepare('DELETE FROM usuarios WHERE id = ?').run(user.id);

        return res.json({
          success: true,
          mensaje: 'Tu cuenta ha sido localizada y eliminada de forma permanente junto con todos sus datos asociados.'
        });
      }
    }

    res.json({
      success: true,
      mensaje: 'Hemos recibido tu solicitud de supresión de datos. Si los datos coinciden con un usuario activo, se procesará en menos de 24 horas laborables.'
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
      SELECT e.*, esc.nombre as escuela_nombre, esc.codigo as escuela_codigo, esc.telefono_sinpe, esc.nombre_sinpe
      FROM estudiantes e
      LEFT JOIN escuelas esc ON esc.id = e.escuela_id
      JOIN padres_estudiantes pe ON e.id = pe.estudiante_id
      WHERE pe.padre_usuario_id = ?
      ORDER BY e.nombre_completo ASC
    `).all(padre_usuario_id);

    if (hijos.length === 0) {
      hijos = db.prepare(`
        SELECT e.*, esc.nombre as escuela_nombre, esc.codigo as escuela_codigo, esc.telefono_sinpe, esc.nombre_sinpe
        FROM estudiantes e
        LEFT JOIN escuelas esc ON esc.id = e.escuela_id
        WHERE e.padre_usuario_id = ?
      `).all(padre_usuario_id);
    }

    const hijosEnriquecidos = hijos.map(h => enriquecerEstudianteFinanzas(h));

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

// Dashboard Ejecutivo del Portal de Padres
app.get('/api/padres/dashboard', (req, res) => {
  try {
    const padreUsuarioId = req.query.padre_usuario_id ? parseInt(req.query.padre_usuario_id, 10) : null;
    if (!padreUsuarioId) return res.status(400).json({ error: 'Falta padre_usuario_id' });

    // 1. Obtener hijos vinculados a este padre
    let hijos = db.prepare(`
      SELECT e.id, e.nombre_completo, e.grado, e.seccion, e.codigo_estudiante, e.saldo_colones, e.foto_url
      FROM estudiantes e
      JOIN padres_estudiantes pe ON e.id = pe.estudiante_id
      WHERE pe.padre_usuario_id = ? AND e.activo = 1
      ORDER BY e.nombre_completo ASC
    `).all(padreUsuarioId);

    if (hijos.length === 0) {
      hijos = db.prepare(`
        SELECT e.id, e.nombre_completo, e.grado, e.seccion, e.codigo_estudiante, e.saldo_colones, e.foto_url
        FROM estudiantes e
        WHERE e.padre_usuario_id = ? AND e.activo = 1
        ORDER BY e.nombre_completo ASC
      `).all(padreUsuarioId);
    }

    if (hijos.length === 0) {
      return res.json({
        periodo: req.query.periodo || 'mes',
        hijos: [],
        resumen: {
          saldo_total: 0,
          saldo_disponible: 0,
          saldo_retenido: 0,
          total_recargas: 0,
          recargas_sinpe: 0,
          recargas_efectivo: 0,
          cant_recargas: 0,
          total_compras: 0,
          cant_compras: 0,
          ticket_promedio: 0
        },
        top_productos: [],
        movimientos: []
      });
    }

    // 2. Filtrar por hijo si se especifica
    const estudianteIdQuery = req.query.estudiante_id;
    let targetIds = hijos.map(h => h.id);
    if (estudianteIdQuery && estudianteIdQuery !== 'todos') {
      const parsedId = parseInt(estudianteIdQuery, 10);
      if (targetIds.includes(parsedId)) {
        targetIds = [parsedId];
      }
    }
    const inPlaceholders = targetIds.map(() => '?').join(',');

    // 3. Manejo de período
    const periodo = req.query.periodo || 'mes';
    const ahora = new Date();
    const fHoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(ahora);
    let fechaInicio = fHoy;
    let fechaFin = fHoy;
    let usarFiltroFechas = true;

    if (periodo === 'hoy') {
      fechaInicio = fHoy;
      fechaFin = fHoy;
    } else if (periodo === '30dias') {
      const d30 = new Date();
      d30.setDate(d30.getDate() - 29);
      fechaInicio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(d30);
      fechaFin = fHoy;
    } else if (periodo === 'mes') {
      fechaInicio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(ahora.getFullYear(), ahora.getMonth(), 1));
      fechaFin = fHoy;
    } else if (periodo === 'todo') {
      usarFiltroFechas = false;
    }

    // 4. Saldo actual y retenido en preórdenes
    const saldosRow = db.prepare(`
      SELECT COALESCE(SUM(saldo_colones), 0) as total
      FROM estudiantes
      WHERE id IN (${inPlaceholders})
    `).get(...targetIds);
    const saldoTotal = saldosRow ? saldosRow.total : 0;

    const retenidoRow = db.prepare(`
      SELECT COALESCE(SUM(total_colones), 0) as total
      FROM ordenes
      WHERE estudiante_id IN (${inPlaceholders}) AND tipo_orden = 'preorden' AND estado IN ('pendiente', 'en_preparacion', 'listo')
    `).get(...targetIds);
    const saldoRetenido = retenidoRow ? retenidoRow.total : 0;
    const saldoDisponible = Math.max(0, saldoTotal - saldoRetenido);

    // 5. Recargas del período
    let sqlRecargas = `
      SELECT 
        COALESCE(SUM(monto_colones), 0) as total_recargas,
        COALESCE(SUM(CASE WHEN tipo = 'recarga_sinpe' THEN monto_colones ELSE 0 END), 0) as recargas_sinpe,
        COALESCE(SUM(CASE WHEN tipo = 'recarga_manual' THEN monto_colones ELSE 0 END), 0) as recargas_efectivo,
        COUNT(*) as cant_recargas
      FROM transacciones_saldo
      WHERE estudiante_id IN (${inPlaceholders})
        AND tipo IN ('recarga_sinpe', 'recarga_manual')
        AND monto_colones > 0
        AND (revertida IS NULL OR revertida = 0)
    `;
    const paramsRecargas = [...targetIds];
    if (usarFiltroFechas) {
      sqlRecargas += ` AND date(fecha, 'localtime') >= ? AND date(fecha, 'localtime') <= ?`;
      paramsRecargas.push(fechaInicio, fechaFin);
    }
    const recargasRow = db.prepare(sqlRecargas).get(...paramsRecargas) || {};

    // 6. Compras / Consumo del período
    let sqlCompras = `
      SELECT 
        COALESCE(SUM(total_colones), 0) as total_compras,
        COUNT(*) as cant_compras,
        ROUND(COALESCE(AVG(total_colones), 0)) as ticket_promedio
      FROM ordenes
      WHERE estudiante_id IN (${inPlaceholders}) AND estado != 'cancelado'
    `;
    const paramsCompras = [...targetIds];
    if (usarFiltroFechas) {
      sqlCompras += ` AND date(creado_en, 'localtime') >= ? AND date(creado_en, 'localtime') <= ?`;
      paramsCompras.push(fechaInicio, fechaFin);
    }
    const comprasRow = db.prepare(sqlCompras).get(...paramsCompras) || {};

    // 7. Top 5 Productos Consumidos
    let sqlTop = `
      SELECT 
        od.nombre_producto,
        COALESCE(SUM(od.cantidad), 0) as cantidad_total,
        COALESCE(SUM(od.subtotal), 0) as total_colones
      FROM orden_detalles od
      JOIN ordenes o ON od.orden_id = o.id
      WHERE o.estudiante_id IN (${inPlaceholders}) AND o.estado != 'cancelado'
    `;
    const paramsTop = [...targetIds];
    if (usarFiltroFechas) {
      sqlTop += ` AND date(o.creado_en, 'localtime') >= ? AND date(o.creado_en, 'localtime') <= ?`;
      paramsTop.push(fechaInicio, fechaFin);
    }
    sqlTop += ` GROUP BY od.nombre_producto ORDER BY cantidad_total DESC, total_colones DESC LIMIT 5`;
    const topProductos = db.prepare(sqlTop).all(...paramsTop);

    // 8. Movimientos recientes (hasta 12)
    let sqlMov = `
      SELECT 
        ts.id, ts.estudiante_id, e.nombre_completo as estudiante_nombre,
        ts.tipo, ts.monto_colones, ts.descripcion, ts.fecha
      FROM transacciones_saldo ts
      JOIN estudiantes e ON ts.estudiante_id = e.id
      WHERE ts.estudiante_id IN (${inPlaceholders})
    `;
    const paramsMov = [...targetIds];
    if (usarFiltroFechas) {
      sqlMov += ` AND date(ts.fecha, 'localtime') >= ? AND date(ts.fecha, 'localtime') <= ?`;
      paramsMov.push(fechaInicio, fechaFin);
    }
    sqlMov += ` ORDER BY ts.fecha DESC, ts.id DESC LIMIT 12`;
    const movimientos = db.prepare(sqlMov).all(...paramsMov);

    res.json({
      periodo,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      hijos,
      resumen: {
        saldo_total: saldoTotal,
        saldo_disponible: saldoDisponible,
        saldo_retenido: saldoRetenido,
        total_recargas: recargasRow.total_recargas || 0,
        recargas_sinpe: recargasRow.recargas_sinpe || 0,
        recargas_efectivo: recargasRow.recargas_efectivo || 0,
        cant_recargas: recargasRow.cant_recargas || 0,
        total_compras: comprasRow.total_compras || 0,
        cant_compras: comprasRow.cant_compras || 0,
        ticket_promedio: comprasRow.ticket_promedio || 0
      },
      top_productos: topProductos,
      movimientos
    });
  } catch (err) {
    console.error('Error en /api/padres/dashboard:', err);
    res.status(500).json({ error: err.message });
  }
});

// Exportar Estado de Cuenta Familiar a Excel
app.get(['/api/padres/export/estado-cuenta.xlsx', '/api/padres/export/estado-cuenta.csv'], (req, res) => {
  try {
    const padreUsuarioId = req.query.padre_usuario_id ? parseInt(req.query.padre_usuario_id, 10) : null;
    if (!padreUsuarioId) return res.status(400).json({ error: 'Falta padre_usuario_id' });

    let hijos = db.prepare(`
      SELECT e.id, e.nombre_completo, e.grado, e.seccion, e.codigo_estudiante
      FROM estudiantes e
      JOIN padres_estudiantes pe ON e.id = pe.estudiante_id
      WHERE pe.padre_usuario_id = ? AND e.activo = 1
    `).all(padreUsuarioId);

    if (hijos.length === 0) {
      hijos = db.prepare(`
        SELECT e.id, e.nombre_completo, e.grado, e.seccion, e.codigo_estudiante
        FROM estudiantes e
        WHERE e.padre_usuario_id = ? AND e.activo = 1
      `).all(padreUsuarioId);
    }

    if (hijos.length === 0) return res.status(404).json({ error: 'No hay estudiantes vinculados' });

    const estudianteIdQuery = req.query.estudiante_id;
    let targetIds = hijos.map(h => h.id);
    if (estudianteIdQuery && estudianteIdQuery !== 'todos') {
      const parsedId = parseInt(estudianteIdQuery, 10);
      if (targetIds.includes(parsedId)) targetIds = [parsedId];
    }
    const inPlaceholders = targetIds.map(() => '?').join(',');

    const periodo = req.query.periodo || 'mes';
    const ahora = new Date();
    const fHoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(ahora);
    let fechaInicio = fHoy;
    let fechaFin = fHoy;
    let usarFiltroFechas = true;

    if (periodo === 'hoy') {
      fechaInicio = fHoy;
      fechaFin = fHoy;
    } else if (periodo === '30dias') {
      const d30 = new Date();
      d30.setDate(d30.getDate() - 29);
      fechaInicio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(d30);
      fechaFin = fHoy;
    } else if (periodo === 'mes') {
      fechaInicio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(ahora.getFullYear(), ahora.getMonth(), 1));
      fechaFin = fHoy;
    } else if (periodo === 'todo') {
      usarFiltroFechas = false;
    }

    let sqlMov = `
      SELECT 
        ts.id, ts.fecha, e.nombre_completo as estudiante_nombre, e.codigo_estudiante,
        ts.tipo, ts.descripcion, ts.monto_colones, ts.saldo_posterior
      FROM transacciones_saldo ts
      JOIN estudiantes e ON ts.estudiante_id = e.id
      WHERE ts.estudiante_id IN (${inPlaceholders})
    `;
    const paramsMov = [...targetIds];
    if (usarFiltroFechas) {
      sqlMov += ` AND date(ts.fecha, 'localtime') >= ? AND date(ts.fecha, 'localtime') <= ?`;
      paramsMov.push(fechaInicio, fechaFin);
    }
    sqlMov += ` ORDER BY ts.fecha DESC, ts.id DESC LIMIT 1000`;
    const transacciones = db.prepare(sqlMov).all(...paramsMov);

    const tipoEtiquetas = {
      'recarga_sinpe': 'Recarga SINPE Móvil',
      'recarga_manual': 'Recarga en Caja',
      'compra_mostrador': 'Compra Mostrador',
      'preorden': 'Compra Pre-orden',
      'reversion_recarga': 'Reversión Recarga',
      'transferencia_enviada': 'Transferencia Enviada',
      'transferencia_recibida': 'Transferencia Recibida'
    };

    const headers = ['Fecha y Hora', 'Estudiante', 'Código Est.', 'Tipo de Movimiento', 'Descripción', 'Monto (CRC)', 'Saldo Posterior (CRC)'];
    const rows = transacciones.map(t => {
      const fechaFmt = t.fecha ? new Date(t.fecha).toLocaleString('es-CR') : '';
      const tipoTxt = tipoEtiquetas[t.tipo] || t.tipo;
      return [
        fechaFmt,
        t.estudiante_nombre,
        t.codigo_estudiante,
        tipoTxt,
        t.descripcion || '',
        Number(t.monto_colones || 0),
        Number(t.saldo_posterior || 0)
      ];
    });

    const filenameBase = `estado_cuenta_familiar_${new Date().toISOString().slice(0, 10)}`;
    responderExportacion(res, req, { sheetName: 'Estado de Cuenta', filenameBase, headers, rows });
  } catch (err) {
    console.error('Error al exportar estado de cuenta:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ENDPOINTS DE ADMINISTRACIÓN DE LA SODA
// ==========================================

// Métricas y Resumen Ejecutivo
app.get('/api/admin/resumen', (req, res) => {
  try {
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;

    let sqlVentas = `
      SELECT COALESCE(SUM(total_colones), 0) as total, COUNT(*) as cantidad
      FROM ordenes 
      WHERE date(creado_en, 'localtime') = date('now', 'localtime')
    `;
    const paramsVentas = [];
    if (escuelaId) {
      sqlVentas += ` AND escuela_id = ?`;
      paramsVentas.push(escuelaId);
    }
    const ventasHoy = db.prepare(sqlVentas).get(...paramsVentas) || { total: 0, cantidad: 0 };

    let sqlEst = `
      SELECT 
        COUNT(*) as total_estudiantes,
        COALESCE(SUM(CASE WHEN tarjeta_bloqueada = 1 THEN 1 ELSE 0 END), 0) as tarjetas_bloqueadas,
        COALESCE(SUM(saldo_colones), 0) as saldo_total
      FROM estudiantes WHERE activo = 1
    `;
    const paramsEst = [];
    if (escuelaId) {
      sqlEst += ` AND escuela_id = ?`;
      paramsEst.push(escuelaId);
    }
    const statsEst = db.prepare(sqlEst).get(...paramsEst) || { total_estudiantes: 0, tarjetas_bloqueadas: 0, saldo_total: 0 };

    let sqlProds = `
      SELECT COUNT(*) as count 
      FROM productos 
      WHERE control_stock = 1 AND (stock <= 3 OR disponible = 0)
    `;
    const paramsProds = [];
    if (escuelaId) {
      sqlProds += ` AND escuela_id = ?`;
      paramsProds.push(escuelaId);
    }
    const productosBajoStockRow = db.prepare(sqlProds).get(...paramsProds);
    const productosBajoStock = productosBajoStockRow ? productosBajoStockRow.count : 0;

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

// Dashboard Ejecutivo de Información y Finanzas de la Soda
app.get('/api/admin/dashboard', (req, res) => {
  try {
    const periodo = req.query.periodo || 'hoy';
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    const ahora = new Date();
    const fHoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(ahora);
    
    let fechaInicio = fHoy;
    let fechaFin = fHoy;
    let usarFiltroFechas = true;

    if (periodo === 'hoy') {
      fechaInicio = fHoy;
      fechaFin = fHoy;
    } else if (periodo === '7dias' || periodo === 'semana') {
      const d7 = new Date();
      d7.setDate(d7.getDate() - 6);
      fechaInicio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(d7);
      fechaFin = fHoy;
    } else if (periodo === 'mes') {
      fechaInicio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(new Date(ahora.getFullYear(), ahora.getMonth(), 1));
      fechaFin = fHoy;
    } else if (periodo === 'todo') {
      usarFiltroFechas = false;
    } else if (req.query.desde) {
      fechaInicio = req.query.desde;
      fechaFin = req.query.hasta || fHoy;
    }

    // 1. Métricas Generales de Órdenes y Ventas
    let sqlOrdenes = `
      SELECT 
        COALESCE(SUM(CASE WHEN estado != 'cancelado' THEN total_colones ELSE 0 END), 0) as total_ventas,
        COALESCE(SUM(CASE WHEN estado != 'cancelado' THEN 1 ELSE 0 END), 0) as ordenes_cobradas,
        ROUND(COALESCE(AVG(CASE WHEN estado != 'cancelado' THEN total_colones ELSE NULL END), 0)) as ticket_promedio,
        COALESCE(SUM(CASE WHEN estado != 'cancelado' AND tipo_orden = 'preorden' THEN total_colones ELSE 0 END), 0) as ventas_preorden,
        COALESCE(SUM(CASE WHEN estado != 'cancelado' AND tipo_orden = 'preorden' THEN 1 ELSE 0 END), 0) as ordenes_preorden,
        COALESCE(SUM(CASE WHEN estado != 'cancelado' AND tipo_orden = 'mostrador' THEN total_colones ELSE 0 END), 0) as ventas_mostrador,
        COALESCE(SUM(CASE WHEN estado != 'cancelado' AND tipo_orden = 'mostrador' THEN 1 ELSE 0 END), 0) as ordenes_mostrador,
        COALESCE(SUM(CASE WHEN estado = 'entregado' THEN 1 ELSE 0 END), 0) as ordenes_entregadas,
        COALESCE(SUM(CASE WHEN estado = 'cancelado' THEN 1 ELSE 0 END), 0) as ordenes_canceladas,
        COALESCE(SUM(CASE WHEN estado IN ('pendiente', 'en_preparacion', 'listo') THEN 1 ELSE 0 END), 0) as ordenes_pendientes
      FROM ordenes
      WHERE 1=1
    `;
    const paramsOrdenes = [];
    if (escuelaId) {
      sqlOrdenes += ` AND escuela_id = ?`;
      paramsOrdenes.push(escuelaId);
    }
    if (usarFiltroFechas) {
      sqlOrdenes += ` AND date(creado_en, 'localtime') >= ? AND date(creado_en, 'localtime') <= ?`;
      paramsOrdenes.push(fechaInicio, fechaFin);
    }
    const ordenesStats = db.prepare(sqlOrdenes).get(...paramsOrdenes);

    // 2. Desglose de Ventas por Momento Escolar
    let sqlMomentos = `
      SELECT momento_entrega, COALESCE(SUM(total_colones), 0) as total, COUNT(*) as cantidad
      FROM ordenes
      WHERE estado != 'cancelado'
    `;
    const paramsMomentos = [];
    if (escuelaId) {
      sqlMomentos += ` AND escuela_id = ?`;
      paramsMomentos.push(escuelaId);
    }
    if (usarFiltroFechas) {
      sqlMomentos += ` AND date(creado_en, 'localtime') >= ? AND date(creado_en, 'localtime') <= ?`;
      paramsMomentos.push(fechaInicio, fechaFin);
    }
    sqlMomentos += ` GROUP BY momento_entrega`;
    const rawMomentos = db.prepare(sqlMomentos).all(...paramsMomentos);

    const mapaMomentos = {
      'primer_recreo': { key: 'primer_recreo', label: '1er Recreo', total: 0, cantidad: 0, color: '#0284c7' },
      'almuerzo': { key: 'almuerzo', label: 'Almuerzo', total: 0, cantidad: 0, color: '#10b981' },
      'segundo_recreo': { key: 'segundo_recreo', label: '2do Recreo', total: 0, cantidad: 0, color: '#f59e0b' },
      'inmediato': { key: 'inmediato', label: 'Mostrador / Inmediato', total: 0, cantidad: 0, color: '#6366f1' }
    };

    rawMomentos.forEach(m => {
      let k = (m.momento_entrega || '').toLowerCase();
      if (k === 'recreo_1' || k === 'primer_recreo') k = 'primer_recreo';
      else if (k === 'recreo_2' || k === 'segundo_recreo') k = 'segundo_recreo';
      else if (k === 'almuerzo') k = 'almuerzo';
      else k = 'inmediato';

      if (mapaMomentos[k]) {
        mapaMomentos[k].total += m.total;
        mapaMomentos[k].cantidad += m.cantidad;
      }
    });
    const momentosList = Object.values(mapaMomentos);

    // 3. Top 5 Productos Más Vendidos
    let sqlTop = `
      SELECT 
        od.nombre_producto,
        COALESCE(SUM(od.cantidad), 0) as cantidad_total,
        COALESCE(SUM(od.subtotal), 0) as recaudacion_total
      FROM orden_detalles od
      JOIN ordenes o ON od.orden_id = o.id
      WHERE o.estado != 'cancelado'
    `;
    const paramsTop = [];
    if (escuelaId) {
      sqlTop += ` AND o.escuela_id = ?`;
      paramsTop.push(escuelaId);
    }
    if (usarFiltroFechas) {
      sqlTop += ` AND date(o.creado_en, 'localtime') >= ? AND date(o.creado_en, 'localtime') <= ?`;
      paramsTop.push(fechaInicio, fechaFin);
    }
    sqlTop += ` GROUP BY od.nombre_producto ORDER BY cantidad_total DESC, recaudacion_total DESC LIMIT 5`;
    const topProductos = db.prepare(sqlTop).all(...paramsTop);

    // 4. Recargas de Saldo
    let sqlRecargas = `
      SELECT 
        COALESCE(SUM(ts.monto_colones), 0) as total_recargas,
        COALESCE(SUM(CASE WHEN ts.tipo = 'recarga_sinpe' THEN ts.monto_colones ELSE 0 END), 0) as recargas_sinpe,
        COALESCE(SUM(CASE WHEN ts.tipo = 'recarga_manual' THEN ts.monto_colones ELSE 0 END), 0) as recargas_efectivo,
        COUNT(*) as cantidad_recargas
      FROM transacciones_saldo ts
      JOIN estudiantes e ON ts.estudiante_id = e.id
      WHERE ts.tipo IN ('recarga_sinpe', 'recarga_manual') AND ts.monto_colones > 0 AND (ts.revertida IS NULL OR ts.revertida = 0)
    `;
    const paramsRecargas = [];
    if (escuelaId) {
      sqlRecargas += ` AND e.escuela_id = ?`;
      paramsRecargas.push(escuelaId);
    }
    if (usarFiltroFechas) {
      sqlRecargas += ` AND date(ts.fecha, 'localtime') >= ? AND date(ts.fecha, 'localtime') <= ?`;
      paramsRecargas.push(fechaInicio, fechaFin);
    }
    const recargasStats = db.prepare(sqlRecargas).get(...paramsRecargas) || {};

    // 5. Saldo Flotante en Monederos Estudiantiles
    let sqlSaldoEst = `
      SELECT 
        COUNT(*) as total_estudiantes,
        COALESCE(SUM(saldo_colones), 0) as saldo_total_estudiantes,
        COALESCE(SUM(CASE WHEN tarjeta_bloqueada = 1 THEN 1 ELSE 0 END), 0) as tarjetas_bloqueadas
      FROM estudiantes
      WHERE activo = 1
    `;
    const paramsSaldoEst = [];
    if (escuelaId) {
      sqlSaldoEst += ` AND escuela_id = ?`;
      paramsSaldoEst.push(escuelaId);
    }
    const saldoEstudiantes = db.prepare(sqlSaldoEst).get(...paramsSaldoEst) || {};

    let sqlRetenido = `
      SELECT COALESCE(SUM(total_colones), 0) as saldo_retenido
      FROM ordenes
      WHERE tipo_orden = 'preorden' AND estado IN ('pendiente', 'en_preparacion', 'listo')
    `;
    const paramsRetenido = [];
    if (escuelaId) {
      sqlRetenido += ` AND escuela_id = ?`;
      paramsRetenido.push(escuelaId);
    }
    const saldoRetenidoRow = db.prepare(sqlRetenido).get(...paramsRetenido);
    const saldoRetenido = saldoRetenidoRow ? saldoRetenidoRow.saldo_retenido : 0;
    const saldoDisponible = Math.max(0, (saldoEstudiantes.saldo_total_estudiantes || 0) - saldoRetenido);

    // 6. Tendencia Últimos 7 Días
    const tendencia7Dias = [];
    const diasSemanaNombres = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const diaIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(d);
      const diaNum = new Intl.DateTimeFormat('es-CR', { timeZone: 'America/Costa_Rica', day: '2-digit', month: '2-digit' }).format(d);
      const diaSem = diasSemanaNombres[d.getDay()];

      let sqlDia = `
        SELECT 
          COALESCE(SUM(CASE WHEN estado != 'cancelado' THEN total_colones ELSE 0 END), 0) as ventas,
          COALESCE(SUM(CASE WHEN estado != 'cancelado' THEN 1 ELSE 0 END), 0) as ordenes
        FROM ordenes
        WHERE date(creado_en, 'localtime') = ?
      `;
      const paramsDia = [diaIso];
      if (escuelaId) {
        sqlDia += ` AND escuela_id = ?`;
        paramsDia.push(escuelaId);
      }
      const statDia = db.prepare(sqlDia).get(...paramsDia);

      tendencia7Dias.push({
        fecha: diaIso,
        etiqueta: `${diaSem} ${diaNum}`,
        ventas: statDia ? statDia.ventas : 0,
        ordenes: statDia ? statDia.ordenes : 0
      });
    }

    // 7. Alertas Operativas
    let sqlSinpePend = `SELECT COUNT(*) as count FROM solicitudes_recarga_sinpe WHERE estado = 'pendiente'`;
    const paramsSinpePend = [];
    if (escuelaId) {
      sqlSinpePend += ` AND (escuela_id = ? OR escuela_id IS NULL)`;
      paramsSinpePend.push(escuelaId);
    }
    const sinpePendientes = db.prepare(sqlSinpePend).get(...paramsSinpePend).count;

    let sqlProdsCrit = `SELECT COUNT(*) as count FROM productos WHERE control_stock = 1 AND (stock <= 3 OR disponible = 0)`;
    const paramsProdsCrit = [];
    if (escuelaId) {
      sqlProdsCrit += ` AND escuela_id = ?`;
      paramsProdsCrit.push(escuelaId);
    }
    const prodsCriticos = db.prepare(sqlProdsCrit).get(...paramsProdsCrit).count;

    res.json({
      periodo,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
      ordenes: ordenesStats,
      recargas: recargasStats,
      saldos: {
        total_circulante: saldoEstudiantes.saldo_total_estudiantes,
        retenido_preordenes: saldoRetenido,
        disponible: saldoDisponible,
        estudiantes_activos: saldoEstudiantes.total_estudiantes,
        tarjetas_bloqueadas: saldoEstudiantes.tarjetas_bloqueadas
      },
      momentos: momentosList,
      top_productos: topProductos,
      tendencia_7dias: tendencia7Dias,
      alertas: {
        sinpe_pendientes: sinpePendientes,
        productos_criticos: prodsCriticos,
        tarjetas_bloqueadas: saldoEstudiantes.tarjetas_bloqueadas
      }
    });
  } catch (err) {
    console.error('Error en /api/admin/dashboard:', err);
    res.status(500).json({ error: err.message });
  }
});

// Listado de inventario para admin
app.get('/api/admin/productos', (req, res) => {
  try {
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    let sql = `
      SELECT p.*, c.nombre as categoria_nombre, c.icono as categoria_icono
      FROM productos p
      JOIN categorias c ON p.categoria_id = c.id
    `;
    const params = [];
    if (escuelaId) {
      sql += ' WHERE p.escuela_id = ?';
      params.push(escuelaId);
    }
    sql += ' ORDER BY p.categoria_id, p.nombre';
    const productos = db.prepare(sql).all(...params);
    res.json(productos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar stock y control
app.put('/api/admin/productos/:id/stock', (req, res) => {
  try {
    const { stock, control_stock, disponible, precio_colones, escuela_id } = req.body;
    const prodId = req.params.id;

    const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(prodId);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const targetEscuelaId = escuela_id ? parseInt(escuela_id, 10) : (req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null);
    if (targetEscuelaId && prod.escuela_id && prod.escuela_id !== targetEscuelaId) {
      return res.status(403).json({ error: 'No tienes permisos para modificar productos de otra escuela.' });
    }

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
    const { delta, escuela_id } = req.body;
    const prodId = req.params.id;

    const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(prodId);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const targetEscuelaId = escuela_id ? parseInt(escuela_id, 10) : (req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null);
    if (targetEscuelaId && prod.escuela_id && prod.escuela_id !== targetEscuelaId) {
      return res.status(403).json({ error: 'No tienes permisos para modificar productos de otra escuela.' });
    }

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

// Crear nuevo producto
app.post('/api/admin/productos', (req, res) => {
  try {
    const {
      nombre, categoria_id, precio_colones, descripcion, icono,
      imagen_url, calorias, cumple_mep, alergenos, disponible,
      control_stock, stock, permite_preorden
    } = req.body;

    if (!nombre || !precio_colones || !categoria_id) {
      return res.status(400).json({ error: 'Nombre, precio y categoría son obligatorios.' });
    }

    const precio = parseInt(precio_colones, 10);
    const catId = parseInt(categoria_id, 10);
    const stockVal = stock !== undefined ? Math.max(0, parseInt(stock, 10)) : 10;
    const ctrlStock = control_stock !== undefined ? (control_stock ? 1 : 0) : 1;
    const disp = disponible !== undefined ? (disponible ? 1 : 0) : (ctrlStock === 1 && stockVal <= 0 ? 0 : 1);
    const mep = cumple_mep !== undefined ? (cumple_mep ? 1 : 0) : 1;

    const escuelaId = req.body.escuela_id ? parseInt(req.body.escuela_id, 10) : 1;

    const info = db.prepare(`
      INSERT INTO productos (
        categoria_id, nombre, descripcion, precio_colones, imagen_url, 
        icono, calorias, cumple_mep, alergenos, disponible, 
        permite_preorden, destacado, control_stock, stock, escuela_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      catId,
      String(nombre).trim(),
      descripcion ? String(descripcion).trim() : 'Alimento de soda escolar',
      precio,
      imagen_url ? String(imagen_url).trim() : '',
      icono || '🥪',
      calorias ? parseInt(calorias, 10) : 220,
      mep,
      (alergenos && !['ninguno', 'ninguno conocido', 'no', 'sin alérgenos', 'sin alergenos'].includes(String(alergenos).trim().toLowerCase())) ? String(alergenos).trim() : null,
      disp,
      permite_preorden !== undefined ? (permite_preorden ? 1 : 0) : 1,
      ctrlStock,
      stockVal,
      escuelaId
    );

    const nuevo = db.prepare(`
      SELECT p.*, c.nombre as categoria_nombre, c.icono as categoria_icono
      FROM productos p
      JOIN categorias c ON p.categoria_id = c.id
      WHERE p.id = ?
    `).get(info.lastInsertRowid);

    broadcastEvent('producto_actualizado', nuevo);
    res.status(201).json(nuevo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modificar producto completo
app.put('/api/admin/productos/:id', (req, res) => {
  try {
    const prodId = parseInt(req.params.id, 10);
    const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(prodId);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const targetEscuelaId = req.body.escuela_id ? parseInt(req.body.escuela_id, 10) : (req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null);
    if (targetEscuelaId && prod.escuela_id && prod.escuela_id !== targetEscuelaId) {
      return res.status(403).json({ error: 'No tienes permisos para modificar productos de otra escuela.' });
    }

    const {
      nombre, categoria_id, precio_colones, descripcion, icono,
      imagen_url, calorias, cumple_mep, alergenos, disponible,
      control_stock, stock, permite_preorden
    } = req.body;

    const precio = precio_colones !== undefined ? parseInt(precio_colones, 10) : prod.precio_colones;
    const catId = categoria_id !== undefined ? parseInt(categoria_id, 10) : prod.categoria_id;
    const stockVal = stock !== undefined ? Math.max(0, parseInt(stock, 10)) : prod.stock;
    const ctrlStock = control_stock !== undefined ? (control_stock ? 1 : 0) : prod.control_stock;
    let disp = disponible !== undefined ? (disponible ? 1 : 0) : prod.disponible;
    if (ctrlStock === 1 && stockVal <= 0) {
      disp = 0;
    }
    const mep = cumple_mep !== undefined ? (cumple_mep ? 1 : 0) : prod.cumple_mep;

    db.prepare(`
      UPDATE productos SET
        nombre = ?, categoria_id = ?, descripcion = ?, precio_colones = ?,
        imagen_url = ?, icono = ?, calorias = ?, cumple_mep = ?,
        alergenos = ?, disponible = ?, permite_preorden = ?,
        control_stock = ?, stock = ?
      WHERE id = ?
    `).run(
      nombre !== undefined ? String(nombre).trim() : prod.nombre,
      catId,
      descripcion !== undefined ? (descripcion ? String(descripcion).trim() : null) : prod.descripcion,
      precio,
      imagen_url !== undefined ? imagen_url : prod.imagen_url,
      icono !== undefined ? icono : prod.icono,
      calorias !== undefined ? (calorias ? parseInt(calorias, 10) : null) : prod.calorias,
      mep,
      alergenos !== undefined ? ((alergenos && !['ninguno', 'ninguno conocido', 'no', 'sin alérgenos', 'sin alergenos'].includes(String(alergenos).trim().toLowerCase())) ? String(alergenos).trim() : null) : prod.alergenos,
      disp,
      permite_preorden !== undefined ? (permite_preorden ? 1 : 0) : prod.permite_preorden,
      ctrlStock,
      stockVal,
      prodId
    );

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

// Eliminar o desactivar producto
app.delete('/api/admin/productos/:id', (req, res) => {
  try {
    const prodId = parseInt(req.params.id, 10);
    const prod = db.prepare('SELECT * FROM productos WHERE id = ?').get(prodId);
    if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });

    const targetEscuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : (req.body.escuela_id ? parseInt(req.body.escuela_id, 10) : null);
    if (targetEscuelaId && prod.escuela_id && prod.escuela_id !== targetEscuelaId) {
      return res.status(403).json({ error: 'No tienes permisos para eliminar productos de otra escuela.' });
    }

    const enOrdenes = db.prepare('SELECT COUNT(*) as count FROM orden_detalles WHERE producto_id = ?').get(prodId).count;
    if (enOrdenes > 0) {
      // Soft-delete para proteger la integridad referencial y reportes contables
      db.prepare('UPDATE productos SET disponible = 0, stock = 0 WHERE id = ?').run(prodId);
      broadcastEvent('producto_actualizado', { id: prodId, disponible: 0, stock: 0 });
      res.json({ exito: true, accion: 'desactivado', mensaje: `"${prod.nombre}" se desactivó del menú ya que tiene ventas históricas asociadas.` });
    } else {
      // Hard delete
      db.prepare('DELETE FROM productos WHERE id = ?').run(prodId);
      broadcastEvent('producto_actualizado', { id: prodId, eliminado: true });
      res.json({ exito: true, accion: 'eliminado', mensaje: `"${prod.nombre}" fue eliminado exitosamente.` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// GESTIÓN DE PERSONAL Y CAJEROS
// ==========================================

// Listar empleados (admin, cajero, vendedor)
app.get('/api/admin/personal', (req, res) => {
  try {
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    let sql = `
      SELECT u.id, u.username, u.rol, u.nombre, u.telefono, u.email, u.activo, u.creado_en, u.escuela_id,
             esc.nombre as escuela_nombre, esc.codigo as escuela_codigo
      FROM usuarios u
      LEFT JOIN escuelas esc ON u.escuela_id = esc.id
      WHERE u.rol IN ('admin', 'cajero', 'vendedor')
    `;
    const params = [];
    if (escuelaId) {
      sql += ' AND u.escuela_id = ?';
      params.push(escuelaId);
    }
    sql += ' ORDER BY u.id ASC';
    const personal = db.prepare(sql).all(...params);
    res.json(personal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear nuevo empleado o cajero
app.post('/api/admin/personal', (req, res) => {
  try {
    const { username, password, rol, nombre, telefono, email, escuela_id } = req.body;
    if (!username || !password || !nombre || !rol) {
      return res.status(400).json({ error: 'Usuario, contraseña, nombre y rol son obligatorios.' });
    }

    const cleanUser = String(username).trim().toLowerCase();
    const cleanPass = String(password).trim();
    const cleanRol = String(rol).trim().toLowerCase();
    const escuelaId = escuela_id ? parseInt(escuela_id, 10) : 1;

    if (!['admin', 'cajero', 'vendedor'].includes(cleanRol)) {
      return res.status(400).json({ error: 'Rol no válido. Debe ser "cajero", "vendedor" o "admin".' });
    }

    const existe = db.prepare('SELECT id FROM usuarios WHERE LOWER(username) = ?').get(cleanUser);
    if (existe) {
      return res.status(400).json({ error: `El usuario "${cleanUser}" ya existe en el sistema.` });
    }

    const info = db.prepare(`
      INSERT INTO usuarios (username, password_hash, rol, nombre, telefono, email, activo, escuela_id)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      cleanUser,
      cleanPass,
      cleanRol,
      String(nombre).trim(),
      telefono ? String(telefono).trim() : null,
      email ? String(email).trim().toLowerCase() : null,
      escuelaId
    );

    const creado = db.prepare(`
      SELECT u.id, u.username, u.rol, u.nombre, u.telefono, u.email, u.activo, u.creado_en, u.escuela_id,
             esc.nombre as escuela_nombre, esc.codigo as escuela_codigo
      FROM usuarios u
      LEFT JOIN escuelas esc ON u.escuela_id = esc.id
      WHERE u.id = ?
    `).get(info.lastInsertRowid);
    res.status(201).json(creado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modificar datos de empleado
app.put('/api/admin/personal/:id', (req, res) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { nombre, rol, telefono, email, password, escuela_id } = req.body;

    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(staffId);
    if (!user) return res.status(404).json({ error: 'Empleado no encontrado' });

    if (escuela_id && user.escuela_id && user.escuela_id !== parseInt(escuela_id, 10)) {
      return res.status(403).json({ error: 'No tienes permisos para modificar personal de otra escuela.' });
    }

    let sql = 'UPDATE usuarios SET nombre = ?, rol = ?, telefono = ?, email = ?';
    let params = [
      String(nombre || user.nombre).trim(),
      rol || user.rol,
      telefono !== undefined ? (telefono ? String(telefono).trim() : null) : user.telefono,
      email !== undefined ? (email ? String(email).trim().toLowerCase() : null) : user.email
    ];

    if (password && String(password).trim().length > 0) {
      sql += ', password_hash = ?';
      params.push(String(password).trim());
    }

    sql += ' WHERE id = ?';
    params.push(staffId);

    db.prepare(sql).run(...params);

    const actualizado = db.prepare(`
      SELECT u.id, u.username, u.rol, u.nombre, u.telefono, u.email, u.activo, u.creado_en, u.escuela_id,
             esc.nombre as escuela_nombre, esc.codigo as escuela_codigo
      FROM usuarios u
      LEFT JOIN escuelas esc ON u.escuela_id = esc.id
      WHERE u.id = ?
    `).get(staffId);
    res.json(actualizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bloquear / Desbloquear empleado
app.put('/api/admin/personal/:id/estado', (req, res) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const { activo, escuela_id } = req.body;
    const nuevoEstado = activo ? 1 : 0;

    if (staffId === 1 && nuevoEstado === 0) {
      return res.status(400).json({ error: 'No es posible bloquear al Administrador Principal.' });
    }

    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(staffId);
    if (!user) return res.status(404).json({ error: 'Empleado no encontrado' });

    if (escuela_id && user.escuela_id && user.escuela_id !== parseInt(escuela_id, 10)) {
      return res.status(403).json({ error: 'No tienes permisos para modificar personal de otra escuela.' });
    }

    db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(nuevoEstado, staffId);
    res.json({ exito: true, id: staffId, activo: nuevoEstado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar empleado
app.delete('/api/admin/personal/:id', (req, res) => {
  try {
    const staffId = parseInt(req.params.id, 10);
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;

    if (staffId === 1) {
      return res.status(400).json({ error: 'No es posible eliminar al Administrador Principal del sistema.' });
    }

    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(staffId);
    if (!user) return res.status(404).json({ error: 'Empleado no encontrado' });

    if (escuelaId && user.escuela_id && user.escuela_id !== escuelaId) {
      return res.status(403).json({ error: 'No tienes permisos para eliminar personal de otra escuela.' });
    }

    db.prepare('DELETE FROM usuarios WHERE id = ?').run(staffId);
    res.json({ exito: true, mensaje: `Empleado "${user.nombre}" eliminado correctamente.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// DEVELOPER MASTER SUITE & DISEÑOS DE TARJETAS
// ==========================================

function getCardThemePredeterminado() {
  try {
    const row = db.prepare('SELECT theme_id FROM disenos_tarjetas WHERE es_predeterminado = 1 AND activo = 1 LIMIT 1').get()
      || db.prepare('SELECT theme_id FROM disenos_tarjetas WHERE activo = 1 ORDER BY id ASC LIMIT 1').get();
    return row ? row.theme_id : 'card_robo_lab';
  } catch (e) {
    return 'card_robo_lab';
  }
}

// Endpoint público para obtener diseños de tarjetas activas (utilizado por el carrusel y app de estudiantes)
app.get('/api/disenos-tarjetas', (req, res) => {
  try {
    const disenos = db.prepare('SELECT * FROM disenos_tarjetas WHERE activo = 1 ORDER BY es_predeterminado DESC, id ASC').all();
    res.json(disenos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar todos los usuarios del sistema (Acceso Developer)
app.get('/api/developer/usuarios', (req, res) => {
  try {
    const usuarios = db.prepare(`
      SELECT u.id, u.username, u.password_hash, u.rol, u.nombre, u.telefono, u.email, u.activo, u.creado_en, u.escuela_id,
        esc.nombre as escuela_nombre, esc.codigo as escuela_codigo,
        (SELECT COUNT(*) FROM estudiantes e WHERE e.usuario_id = u.id) as es_estudiante,
        (SELECT e.codigo_estudiante FROM estudiantes e WHERE e.usuario_id = u.id LIMIT 1) as estudiante_codigo,
        (SELECT e.grado FROM estudiantes e WHERE e.usuario_id = u.id LIMIT 1) as estudiante_grado,
        (SELECT COUNT(*) FROM padres_estudiantes pe WHERE pe.padre_usuario_id = u.id) as hijos_vinculados
      FROM usuarios u
      LEFT JOIN escuelas esc ON u.escuela_id = esc.id
      ORDER BY 
        CASE u.rol 
          WHEN 'developer' THEN 1 
          WHEN 'admin' THEN 2 
          WHEN 'cajero' THEN 3 
          WHEN 'vendedor' THEN 4 
          WHEN 'padre' THEN 5 
          ELSE 6 
        END, u.id ASC
    `).all();
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear cualquier usuario con cualquier rol (Admin, Developer, Cajero, etc.)
app.post('/api/developer/usuarios', (req, res) => {
  try {
    const { username, password, rol, nombre, telefono, email, activo, escuela_id } = req.body;
    if (!username || !password || !nombre || !rol) {
      return res.status(400).json({ error: 'Usuario, contraseña, nombre y rol son obligatorios.' });
    }

    const cleanUser = String(username).trim().toLowerCase();
    const cleanPass = String(password).trim();
    const cleanRol = String(rol).trim().toLowerCase();
    const cleanActivo = activo === 0 ? 0 : 1;
    const escuelaId = escuela_id ? parseInt(escuela_id, 10) : null;

    const existe = db.prepare('SELECT id FROM usuarios WHERE LOWER(username) = ?').get(cleanUser);
    if (existe) {
      return res.status(400).json({ error: `El nombre de usuario "${cleanUser}" ya se encuentra registrado.` });
    }

    const defaultTheme = getCardThemePredeterminado();
    const result = db.prepare(`
      INSERT INTO usuarios (username, password_hash, rol, nombre, telefono, email, activo, escuela_id, card_theme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cleanUser, cleanPass, cleanRol, String(nombre).trim(), telefono || '', email || '', cleanActivo, escuelaId, defaultTheme);

    res.status(201).json({
      exito: true,
      mensaje: `Usuario "${nombre}" (${cleanRol}) creado exitosamente con privilegios.`,
      usuario: { id: result.lastInsertRowid, username: cleanUser, rol: cleanRol, nombre, activo: cleanActivo, escuela_id: escuelaId, card_theme: defaultTheme }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modificar datos completos de cualquier usuario (incluyendo administradores)
app.put('/api/developer/usuarios/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { username, nombre, rol, telefono, email, password, activo, escuela_id } = req.body;

    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    // Validar nombre de usuario único si cambió
    if (username && username.trim().toLowerCase() !== user.username.toLowerCase()) {
      const existe = db.prepare('SELECT id FROM usuarios WHERE LOWER(username) = ? AND id != ?').get(username.trim().toLowerCase(), userId);
      if (existe) {
        return res.status(400).json({ error: 'Ese nombre de usuario ya pertenece a otra cuenta.' });
      }
    }

    const nuevoUser = username ? username.trim().toLowerCase() : user.username;
    const nuevoNombre = nombre ? nombre.trim() : user.nombre;
    const nuevoRol = rol ? rol.trim().toLowerCase() : user.rol;
    const nuevoPass = (password && String(password).trim().length > 0) ? String(password).trim() : user.password_hash;
    const nuevoTel = telefono !== undefined ? telefono : user.telefono;
    const nuevoEmail = email !== undefined ? email : user.email;
    const nuevoActivo = activo !== undefined ? (activo ? 1 : 0) : user.activo;
    const nuevoEscuelaId = escuela_id !== undefined ? (escuela_id ? parseInt(escuela_id, 10) : null) : user.escuela_id;

    db.prepare(`
      UPDATE usuarios 
      SET username = ?, nombre = ?, rol = ?, password_hash = ?, telefono = ?, email = ?, activo = ?, escuela_id = ?
      WHERE id = ?
    `).run(nuevoUser, nuevoNombre, nuevoRol, nuevoPass, nuevoTel, nuevoEmail, nuevoActivo, nuevoEscuelaId, userId);

    res.json({
      exito: true,
      mensaje: `Usuario "${nuevoNombre}" actualizado con éxito.`,
      usuario: { id: userId, username: nuevoUser, nombre: nuevoNombre, rol: nuevoRol, activo: nuevoActivo, escuela_id: nuevoEscuelaId }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cambio directo de contraseña de cualquier usuario
app.put('/api/developer/usuarios/:id/password', (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { password } = req.body;
    if (!password || String(password).trim().length === 0) {
      return res.status(400).json({ error: 'La nueva contraseña no puede estar vacía.' });
    }

    const user = db.prepare('SELECT id, nombre, username FROM usuarios WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(String(password).trim(), userId);
    res.json({ exito: true, mensaje: `Contraseña de "${user.nombre}" cambiada correctamente.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bloquear / Desbloquear usuario
app.put('/api/developer/usuarios/:id/estado', (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { activo } = req.body;
    const nuevoEstado = activo ? 1 : 0;

    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    if (user.username === 'dev' && nuevoEstado === 0) {
      return res.status(400).json({ error: 'No es posible bloquear la cuenta Developer Master principal.' });
    }

    db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(nuevoEstado, userId);
    res.json({
      exito: true,
      mensaje: `El usuario "${user.nombre}" ahora está ${nuevoEstado ? 'activo' : 'bloqueado'}.`,
      activo: nuevoEstado
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar usuario
app.delete('/api/developer/usuarios/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    if (user.username === 'dev') {
      return res.status(400).json({ error: 'No es posible eliminar la cuenta Developer Master del sistema.' });
    }

    db.prepare('DELETE FROM usuarios WHERE id = ?').run(userId);
    res.json({ exito: true, mensaje: `Usuario "${user.nombre}" eliminado definitivamente.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar todos los diseños de tarjetas (panel developer)
app.get('/api/developer/disenos-tarjetas', (req, res) => {
  try {
    const disenos = db.prepare('SELECT * FROM disenos_tarjetas ORDER BY id ASC').all();
    res.json(disenos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subir nuevo diseño de tarjeta (soporta Base64 o URL directa)
app.post('/api/developer/disenos-tarjetas', (req, res) => {
  try {
    const { nombre, categoria, estilo_texto, image_base64, image_url, es_predeterminado } = req.body;
    if (!nombre) {
      return res.status(400).json({ error: 'El nombre del diseño es obligatorio.' });
    }

    let finalImageUrl = image_url;

    // Si viene imagen en base64, guardarla en disco en public/img/cards/
    if (image_base64 && image_base64.startsWith('data:image/')) {
      const matches = image_base64.match(/^data:image\/([a-zA-Z0-9\+\-]+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({ error: 'Formato de imagen base64 no válido.' });
      }

      let ext = matches[1].toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
      if (ext === 'svg+xml') ext = 'svg';

      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');

      const cardsDir = path.join(__dirname, '../public/img/cards');
      if (!fs.existsSync(cardsDir)) {
        fs.mkdirSync(cardsDir, { recursive: true });
      }

      const filename = `card_custom_${Date.now()}.${ext}`;
      const filePath = path.join(cardsDir, filename);
      fs.writeFileSync(filePath, buffer);

      finalImageUrl = `/img/cards/${filename}`;
    }

    if (!finalImageUrl) {
      return res.status(400).json({ error: 'Debes subir una imagen o indicar una URL válida.' });
    }

    const themeId = `card_custom_${Date.now()}`;
    const cleanCat = ['fem', 'masc', 'uni'].includes(categoria) ? categoria : 'uni';
    const cleanEstilo = estilo_texto === 'light' ? 'light' : 'dark';
    const cleanPred = es_predeterminado ? 1 : 0;

    if (cleanPred === 1) {
      db.prepare('UPDATE disenos_tarjetas SET es_predeterminado = 0').run();
    }

    const result = db.prepare(`
      INSERT INTO disenos_tarjetas (theme_id, nombre, categoria, imagen_url, estilo_texto, es_predeterminado, activo)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(themeId, String(nombre).trim(), cleanCat, finalImageUrl, cleanEstilo, cleanPred);

    const nuevoDiseno = db.prepare('SELECT * FROM disenos_tarjetas WHERE id = ?').get(result.lastInsertRowid);
    broadcastEvent('disenos_actualizados', nuevoDiseno);

    res.status(201).json({
      exito: true,
      mensaje: `¡Diseño "${nombre}" guardado y publicado con éxito para todos los estudiantes!`,
      diseno: nuevoDiseno
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Establecer diseño como predeterminado para todos los nuevos usuarios
app.put('/api/developer/disenos-tarjetas/:id/predeterminada', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const diseno = db.prepare('SELECT * FROM disenos_tarjetas WHERE id = ?').get(id);
    if (!diseno) return res.status(404).json({ error: 'Diseño no encontrado.' });

    db.transaction(() => {
      db.prepare('UPDATE disenos_tarjetas SET es_predeterminado = 0').run();
      db.prepare('UPDATE disenos_tarjetas SET es_predeterminado = 1, activo = 1 WHERE id = ?').run(id);
    })();

    const actualizado = db.prepare('SELECT * FROM disenos_tarjetas WHERE id = ?').get(id);
    broadcastEvent('disenos_actualizados', actualizado);

    res.json({
      exito: true,
      mensaje: `¡El diseño "${diseno.nombre}" ahora es el diseño predeterminado para todos los nuevos usuarios!`,
      diseno: actualizado
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activar / Desactivar diseño de tarjeta
app.put('/api/developer/disenos-tarjetas/:id/estado', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { activo } = req.body;
    const nuevoEstado = activo ? 1 : 0;

    db.prepare('UPDATE disenos_tarjetas SET activo = ? WHERE id = ?').run(nuevoEstado, id);
    const diseno = db.prepare('SELECT * FROM disenos_tarjetas WHERE id = ?').get(id);

    broadcastEvent('disenos_actualizados', diseno);
    res.json({ exito: true, diseno, activo: nuevoEstado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar diseño personalizado de tarjeta de un estudiante
app.put('/api/estudiantes/:id/card-theme', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { card_theme } = req.body;
    if (!card_theme) return res.status(400).json({ error: 'card_theme es obligatorio.' });

    db.prepare('UPDATE estudiantes SET card_theme = ? WHERE id = ?').run(String(card_theme).trim(), id);
    res.json({ exito: true, card_theme: String(card_theme).trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar diseño de tarjeta
app.delete('/api/developer/disenos-tarjetas/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const diseno = db.prepare('SELECT * FROM disenos_tarjetas WHERE id = ?').get(id);
    if (!diseno) return res.status(404).json({ error: 'Diseño no encontrado.' });

    db.prepare('DELETE FROM disenos_tarjetas WHERE id = ?').run(id);
    broadcastEvent('disenos_actualizados', { id, eliminado: true });

    res.json({ exito: true, mensaje: `Diseño "${diseno.nombre}" eliminado.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Métricas de Diagnóstico del Sistema y Base de Datos (Developer)
app.get('/api/developer/stats', (req, res) => {
  try {
    const totalUsuarios = db.prepare('SELECT COUNT(*) as count FROM usuarios').get().count;
    const rolesCount = db.prepare('SELECT rol, COUNT(*) as count FROM usuarios GROUP BY rol').all();
    const totalEstudiantes = db.prepare('SELECT COUNT(*) as count FROM estudiantes').get().count;
    const saldoTotal = db.prepare('SELECT COALESCE(SUM(saldo_colones), 0) as total FROM estudiantes').get().total;
    const totalProductos = db.prepare('SELECT COUNT(*) as count FROM productos WHERE disponible = 1').get().count;
    const totalOrdenes = db.prepare('SELECT COUNT(*) as count FROM ordenes').get().count;
    const totalTransacciones = db.prepare('SELECT COUNT(*) as count FROM transacciones_saldo').get().count;
    const totalDisenos = db.prepare('SELECT COUNT(*) as count FROM disenos_tarjetas WHERE activo = 1').get().count;

    let dbTipo = Boolean(process.env.DATABASE_URL) ? 'PostgreSQL' : 'SQLite';
    let dbDetalle = Boolean(process.env.DATABASE_URL) ? 'PostgreSQL Central (sibopay_db)' : 'WAL Mode Activado';
    let dbSizeFormatted = '0 KB';
    let dbSizeBytes = 0;

    if (Boolean(process.env.DATABASE_URL)) {
      try {
        const sizeRes = db.prepare("SELECT pg_size_pretty(pg_database_size(current_database())) as size").get();
        dbSizeFormatted = sizeRes && sizeRes.size ? sizeRes.size : '9.5 MB';
      } catch (e) {
        dbSizeFormatted = '9.5 MB';
      }
    } else {
      try {
        const stats = fs.statSync(path.join(__dirname, 'recreopay.db'));
        dbSizeBytes = stats.size;
        dbSizeFormatted = (dbSizeBytes / 1024).toFixed(1) + ' KB';
      } catch (e) {}
    }

    res.json({
      usuarios: {
        total: totalUsuarios,
        por_rol: rolesCount
      },
      estudiantes: {
        total: totalEstudiantes,
        saldo_circulante_colones: saldoTotal
      },
      negocio: {
        productos_activos: totalProductos,
        ordenes_totales: totalOrdenes,
        transacciones_totales: totalTransacciones,
        disenos_tarjetas_activas: totalDisenos
      },
      sistema: {
        node_version: process.version,
        uptime_segundos: Math.floor(process.uptime()),
        memoria_mb: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
        db_tipo: dbTipo,
        db_detalle: dbDetalle,
        db_size_formatted: dbSizeFormatted,
        db_size_kb: (dbSizeBytes / 1024).toFixed(1),
        sse_clientes_conectados: sseClients.size
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// GESTIÓN MULTI-ESCUELA / MULTI-TENANT (DEVELOPER MASTER)
// ==========================================

// Listar todas las escuelas y sus estadísticas de operación
app.get('/api/developer/escuelas', (req, res) => {
  try {
    const escuelas = db.prepare(`
      SELECT e.*,
             (SELECT COUNT(*) FROM estudiantes est WHERE est.escuela_id = e.id) as total_estudiantes,
             (SELECT COUNT(*) FROM productos p WHERE p.escuela_id = e.id) as total_productos,
             (SELECT COUNT(*) FROM ordenes o WHERE o.escuela_id = e.id) as total_ordenes,
             (SELECT COALESCE(SUM(total_colones), 0) FROM ordenes o WHERE o.escuela_id = e.id) as ventas_totales
      FROM escuelas e
      ORDER BY e.id ASC
    `).all();
    res.json(escuelas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear una nueva escuela con catálogo base y cuentas operativas automáticas
app.post('/api/developer/escuelas', (req, res) => {
  try {
    const { codigo, nombre, telefono_sinpe, nombre_sinpe, concesionario } = req.body;
    if (!codigo || !nombre) {
      return res.status(400).json({ error: 'Código y Nombre de la escuela son obligatorios' });
    }

    const cleanCod = codigo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cleanNom = nombre.trim();
    const tel = (telefono_sinpe || '8888-8888').trim();
    const nomSinpe = (nombre_sinpe || cleanNom).trim();
    const conce = (concesionario || 'Concesionario ' + cleanNom).trim();

    const exists = db.prepare('SELECT id FROM escuelas WHERE codigo = ?').get(cleanCod);
    if (exists) {
      return res.status(400).json({ error: `El código de escuela '${cleanCod}' ya existe.` });
    }

    const insertRes = db.prepare(`
      INSERT INTO escuelas (codigo, nombre, telefono_sinpe, nombre_sinpe, concesionario, activo, hora_recreo_1, hora_almuerzo, hora_recreo_2)
      VALUES (?, ?, ?, ?, ?, true, '09:30', '11:45', '13:45')
    `).run(cleanCod, cleanNom, tel, nomSinpe, conce);

    const newEscuelaId = insertRes.lastInsertRowid || insertRes.id;

    // Clonar catálogo base de productos saludables MEP de la Escuela #1
    try {
      const prodsBase = db.prepare('SELECT categoria_id, nombre, descripcion, precio_colones, imagen_url, icono, calorias, cumple_mep, alergenos, permite_preorden, destacado FROM productos WHERE escuela_id = 1').all();
      for (const p of prodsBase) {
        db.prepare(`
          INSERT INTO productos (categoria_id, nombre, descripcion, precio_colones, imagen_url, icono, calorias, cumple_mep, alergenos, permite_preorden, destacado, escuela_id, disponible)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(p.categoria_id, p.nombre, p.descripcion, p.precio_colones, p.imagen_url, p.icono, p.calorias, p.cumple_mep, p.alergenos, p.permite_preorden, p.destacado, newEscuelaId);
      }
    } catch (e) {
      console.warn('Advertencia clonando catálogo inicial:', e.message);
    }

    // Crear cuentas operativas de cajero y administrador para la nueva escuela
    const cajeroUser = `cajero_${cleanCod.toLowerCase()}`;
    const adminUser = `admin_${cleanCod.toLowerCase()}`;
    try {
      db.prepare(`
        INSERT INTO usuarios (username, password_hash, rol, nombre, telefono, activo, escuela_id)
        VALUES (?, '123456', 'cajero', ?, ?, 1, ?)
      `).run(cajeroUser, `Cajero Soda ${cleanNom}`, tel, newEscuelaId);

      db.prepare(`
        INSERT INTO usuarios (username, password_hash, rol, nombre, telefono, activo, escuela_id)
        VALUES (?, '123456', 'admin', ?, ?, 1, ?)
      `).run(adminUser, `Administrador Soda ${cleanNom}`, tel, newEscuelaId);
    } catch (e) {
      console.warn('Advertencia creando usuarios iniciales:', e.message);
    }

    res.status(201).json({
      success: true,
      escuela_id: newEscuelaId,
      codigo: cleanCod,
      nombre: cleanNom,
      cajero_usuario: cajeroUser,
      admin_usuario: adminUser,
      mensaje: `¡Escuela "${cleanNom}" dada de alta con éxito! Se crearon sus cuentas operativas y catálogo.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activar o pausar una escuela
app.put('/api/developer/escuelas/:id/estado', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { activo } = req.body;
    const nuevoEstado = !!activo;
    db.prepare('UPDATE escuelas SET activo = ? WHERE id = ?').run(nuevoEstado, id);
    res.json({ success: true, activo: nuevoEstado ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// MÓDULO DE COPIAS DE SEGURIDAD (BACKUPS)
// ==========================================
const backupsDir = path.join(__dirname, 'backups');
if (!fs.existsSync(backupsDir)) {
  try { fs.mkdirSync(backupsDir, { recursive: true }); } catch (e) {}
}

function rotarBackups() {
  try {
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('sibopay_'))
      .map(f => {
        const p = path.join(backupsDir, f);
        return { name: f, path: p, time: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.time - a.time);
    if (files.length > 20) {
      for (const oldFile of files.slice(20)) {
        try { fs.unlinkSync(oldFile.path); } catch (e) {}
      }
    }
  } catch (e) {}
}

async function ejecutarBackupBaseDatos() {
  const isPg = Boolean(process.env.DATABASE_URL);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

  if (isPg) {
    const filename = `sibopay_pg_${timestamp}.sql`;
    const targetPath = path.join(backupsDir, filename);
    const dbUrl = process.env.DATABASE_URL;
    const parsed = new URL(dbUrl);
    const user = parsed.username || 'sibopay_user';
    const password = parsed.password || '';
    const host = parsed.hostname || '127.0.0.1';
    const port = parsed.port || '5432';
    const dbname = parsed.pathname ? parsed.pathname.replace(/^\//, '') : 'sibopay_db';

    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      const cmd = `PGPASSWORD="${password}" pg_dump -h ${host} -p ${port} -U ${user} -d ${dbname} --clean > "${targetPath}"`;
      exec(cmd, (err, stdout, stderr) => {
        if (err) return reject(new Error('Fallo al ejecutar pg_dump: ' + (stderr || err.message)));
        const stat = fs.statSync(targetPath);
        rotarBackups();
        resolve({
          filename,
          sizeBytes: stat.size,
          sizeFmt: (stat.size / 1024).toFixed(1) + ' KB',
          fecha: now.toISOString(),
          tipo: 'PostgreSQL'
        });
      });
    });
  } else {
    const filename = `sibopay_sqlite_${timestamp}.db`;
    const targetPath = path.join(backupsDir, filename);
    const sqliteSource = path.join(__dirname, 'recreopay.db');
    if (fs.existsSync(sqliteSource)) {
      fs.copyFileSync(sqliteSource, targetPath);
    }
    const stat = fs.existsSync(targetPath) ? fs.statSync(targetPath) : { size: 0 };
    rotarBackups();
    return {
      filename,
      sizeBytes: stat.size,
      sizeFmt: (stat.size / 1024).toFixed(1) + ' KB',
      fecha: now.toISOString(),
      tipo: 'SQLite'
    };
  }
}

// Programar backup automático cada 24 horas (iniciado tras 5 minutos de uptime)
setTimeout(() => {
  ejecutarBackupBaseDatos().catch(() => {});
  setInterval(() => {
    ejecutarBackupBaseDatos().catch(() => {});
  }, 24 * 60 * 60 * 1000);
}, 5 * 60 * 1000);

// Endpoint: Listar backups existentes (Developer)
app.get('/api/developer/backups', (req, res) => {
  try {
    if (!fs.existsSync(backupsDir)) {
      return res.json({ backups: [] });
    }
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('sibopay_'))
      .map(f => {
        const p = path.join(backupsDir, f);
        const stat = fs.statSync(p);
        return {
          filename: f,
          sizeBytes: stat.size,
          sizeFmt: (stat.size / 1024).toFixed(1) + ' KB',
          fecha: stat.mtime.toISOString(),
          tipo: f.includes('_pg_') ? 'PostgreSQL' : 'SQLite'
        };
      })
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    res.json({ backups: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Crear backup manual inmediato (Developer)
app.post('/api/developer/backups/crear', async (req, res) => {
  try {
    const backupInfo = await ejecutarBackupBaseDatos();
    res.json({
      exito: true,
      mensaje: `Respaldo "${backupInfo.filename}" generado exitosamente (${backupInfo.sizeFmt}).`,
      backup: backupInfo
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Descargar archivo de backup (Developer)
app.get('/api/developer/backups/descargar/:filename', (req, res) => {
  try {
    const safeFilename = path.basename(req.params.filename);
    const targetPath = path.join(backupsDir, safeFilename);
    if (!fs.existsSync(targetPath)) {
      return res.status(404).send('Archivo de respaldo no encontrado.');
    }
    res.download(targetPath, safeFilename);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ==========================================
// ENDPOINTS TERMINAL WEB Y LOGS EN VIVO (DEVELOPER)
// ==========================================
app.get('/api/developer/logs', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '300', 10), MAX_SERVER_LOGS);
    const filterLevel = req.query.level;
    const filterQuery = (req.query.q || '').toLowerCase().trim();
    let result = serverLogsBuffer;
    
    if (filterLevel && filterLevel !== 'all') {
      result = result.filter(l => l.level === filterLevel || l.tag.toLowerCase() === filterLevel.toLowerCase());
    }
    if (filterQuery) {
      result = result.filter(l => l.message.toLowerCase().includes(filterQuery) || l.tag.toLowerCase().includes(filterQuery));
    }
    
    const mem = process.memoryUsage();
    res.json({
      logs: result.slice(-limit),
      totalCount: serverLogsBuffer.length,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryMb: (mem.rss / (1024 * 1024)).toFixed(1),
      heapMb: (mem.heapUsed / (1024 * 1024)).toFixed(1),
      nodeVersion: process.version,
      pid: process.pid,
      activeStreamClients: devLogClients.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/developer/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  devLogClients.add(res);

  res.write(`event: handshake\ndata: ${JSON.stringify({ 
    message: 'Terminal conectada en vivo al servidor', 
    timestamp: new Date().toISOString(),
    pid: process.pid,
    nodeVersion: process.version
  })}\n\n`);

  req.on('close', () => {
    devLogClients.delete(res);
  });
});

app.post('/api/developer/logs/clear', (req, res) => {
  try {
    serverLogsBuffer.length = 0;
    pushServerLog('info', 'TERMINAL', 'Buffer de logs reiniciado manualmente por el desarrollador.');
    res.json({ success: true, message: 'Terminal de logs limpiada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// CARGA MASIVA DE ESTUDIANTES (DEVELOPER)
// ==========================================
app.post('/api/developer/estudiantes/importar-masivo', (req, res) => {
  try {
    const { escuela_id, estudiantes } = req.body;
    if (!escuela_id) {
      return res.status(400).json({ error: 'Debes seleccionar la escuela de destino.' });
    }
    if (!Array.isArray(estudiantes) || estudiantes.length === 0) {
      return res.status(400).json({ error: 'No se recibieron estudiantes para importar.' });
    }

    const escuela = db.prepare('SELECT id, codigo, nombre FROM escuelas WHERE id = ?').get(escuela_id);
    if (!escuela) {
      return res.status(404).json({ error: 'La escuela seleccionada no existe.' });
    }

    const schoolPrefix = (escuela.codigo || 'EST').toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
    const year = new Date().getFullYear();

    const maxRow = db.prepare('SELECT MAX(id) as maxId FROM estudiantes').get();
    let currentSeq = (maxRow && maxRow.maxId ? maxRow.maxId : 0) + 1;
    const defaultCardTheme = getCardThemePredeterminado();

    let insertados = 0;
    let omitidos = 0;
    const errores = [];
    const resultados = [];

    const insertEstStmt = db.prepare(`
      INSERT INTO estudiantes (
        codigo_estudiante, nombre_completo, edad, grado, seccion,
        qr_token, pin_seguridad, foto_url, saldo_colones, limite_diario_colones,
        alergias, padre_nombre, padre_telefono, permitir_transferencias,
        tarjeta_bloqueada, activo, escuela_id, card_theme
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)
    `);

    const insertTxStmt = db.prepare(`
      INSERT INTO transacciones_saldo (
        estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, descripcion, escuela_id
      ) VALUES (?, 'recarga_manual', ?, 0, ?, 'Saldo inicial asignado por importación masiva', ?)
    `);

    const insertUserStmt = db.prepare(`
      INSERT INTO usuarios (username, password_hash, rol, nombre, activo, escuela_id, card_theme)
      VALUES (?, ?, 'estudiante', ?, 1, ?, ?)
    `);

    const processImport = db.transaction(() => {
      for (let i = 0; i < estudiantes.length; i++) {
        const item = estudiantes[i];
        const rawNombre = item.nombre_completo || item.nombre || '';
        const cleanNombre = String(rawNombre).trim();

        if (!cleanNombre) {
          omitidos++;
          errores.push(`Fila ${i + 1}: Nombre vacío.`);
          continue;
        }

        const grado = String(item.grado || item.nivel || 'Primaria').trim();
        const seccion = String(item.seccion || item.grupo || 'A').trim();
        const saldoInicial = Math.max(0, parseInt(item.saldo_inicial || item.saldo || 0, 10));
        const limiteDiario = Math.max(500, parseInt(item.limite_diario || 3000, 10));
        const alergias = String(item.alergias || 'Ninguna conocida').trim();
        const padreNombre = String(item.padre_nombre || item.encargado || '').trim();
        const padreTelefono = String(item.padre_telefono || item.telefono || '').trim();
        const edad = parseInt(item.edad || 10, 10);
        const pin = String(item.pin || '1234').trim();

        let codigoEstudiante = item.codigo ? String(item.codigo).trim().toUpperCase() : null;
        if (codigoEstudiante) {
          const existe = db.prepare('SELECT id FROM estudiantes WHERE codigo_estudiante = ?').get(codigoEstudiante);
          if (existe) {
            omitidos++;
            errores.push(`Fila ${i + 1} ("${cleanNombre}"): El código "${codigoEstudiante}" ya está registrado.`);
            continue;
          }
        } else {
          codigoEstudiante = `${schoolPrefix}-${year}-${String(currentSeq).padStart(5, '0')}`;
        }

        const primerNombre = cleanNombre.split(' ')[0].toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const randomHex = Math.random().toString(16).substring(2, 6).toUpperCase();
        const qrToken = `QR-${schoolPrefix}-${primerNombre}-${year}-${String(currentSeq).padStart(5, '0')}-${randomHex}`;

        const resEst = insertEstStmt.run(
          codigoEstudiante,
          cleanNombre,
          edad,
          grado,
          seccion,
          qrToken,
          pin,
          saldoInicial,
          limiteDiario,
          alergias,
          padreNombre,
          padreTelefono,
          escuela_id,
          defaultCardTheme
        );

        const newEstId = resEst.lastInsertRowid || resEst.id;

        if (saldoInicial > 0) {
          insertTxStmt.run(newEstId, saldoInicial, saldoInicial, escuela_id);
        }

        const usernameEst = primerNombre.toLowerCase() + currentSeq;
        try {
          const resUser = insertUserStmt.run(usernameEst, pin, cleanNombre, escuela_id, defaultCardTheme);
          const userId = resUser.lastInsertRowid || resUser.id;
          db.prepare('UPDATE estudiantes SET usuario_id = ? WHERE id = ?').run(userId, newEstId);
        } catch (e) {}

        currentSeq++;
        insertados++;
        resultados.push({ id: newEstId, codigo: codigoEstudiante, nombre: cleanNombre });
      }
    });

    processImport();

    res.json({
      exito: true,
      totalProcesados: estudiantes.length,
      insertados,
      omitidos,
      errores,
      estudiantes: resultados.slice(0, 100),
      mensaje: `¡Importación completada! Se crearon ${insertados} estudiante(s) con éxito en "${escuela.nombre}".`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// BUSCADOR UNIVERSAL Y AUDITORÍA SINPE (DEVELOPER)
// ==========================================

// 0. Listar / Buscar estudiantes para developer y admin
app.get(['/api/admin/estudiantes', '/api/developer/estudiantes/buscar'], (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    let sql = `
      SELECT e.id, e.nombre_completo, e.codigo_estudiante, e.grado, e.seccion,
             e.saldo_colones, e.escuela_id, e.padre_nombre, e.padre_telefono,
             esc.nombre as escuela_nombre, esc.codigo as escuela_codigo
      FROM estudiantes e
      LEFT JOIN escuelas esc ON esc.id = e.escuela_id
      WHERE e.activo = 1
    `;
    const params = [];
    if (escuelaId) {
      sql += ' AND e.escuela_id = ?';
      params.push(escuelaId);
    }
    sql += ' ORDER BY e.nombre_completo ASC LIMIT 500';
    let list = db.prepare(sql).all(...params);
    if (q) {
      const normQ = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      list = list.filter(e => {
        const n = (e.nombre_completo || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const c = (e.codigo_estudiante || '').toLowerCase();
        const p = (e.padre_nombre || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const t = (e.padre_telefono || '').toLowerCase();
        return n.includes(normQ) || c.includes(normQ) || p.includes(normQ) || t.includes(normQ);
      });
    }
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 0.1 Kardex 360° Integral de Estudiante (Developer)
app.get('/api/developer/estudiantes/:id/kardex', (req, res) => {
  try {
    const estId = parseInt(req.params.id, 10);
    const est = db.prepare(`
      SELECT e.*, esc.nombre as escuela_nombre, esc.codigo as escuela_codigo
      FROM estudiantes e
      LEFT JOIN escuelas esc ON esc.id = e.escuela_id
      WHERE e.id = ?
    `).get(estId);

    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado' });

    // 1. Movimientos contables (Kardex completo de transacciones_saldo)
    const movimientos = db.prepare(`
      SELECT ts.*, o.codigo_orden
      FROM transacciones_saldo ts
      LEFT JOIN ordenes o ON ts.orden_id = o.id
      WHERE ts.estudiante_id = ?
      ORDER BY ts.fecha DESC, ts.id DESC
      LIMIT 200
    `).all(estId);

    // 2. Compras en soda (con desglose de productos)
    const ordenesRaw = db.prepare(`
      SELECT o.*,
        (SELECT json_group_array(json_object('producto_id', d.producto_id, 'nombre', COALESCE(d.nombre_producto, p.nombre), 'icono', COALESCE(p.icono, '🥪'), 'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario, 'subtotal', d.subtotal))
         FROM orden_detalles d LEFT JOIN productos p ON d.producto_id = p.id WHERE d.orden_id = o.id) as items_json
      FROM ordenes o
      WHERE o.estudiante_id = ?
      ORDER BY o.creado_en DESC, o.id DESC
      LIMIT 100
    `).all(estId);

    const compras = ordenesRaw.map(o => ({
      ...o,
      momento_entrega_label: formatMomentoLabel(o.momento_entrega, o.escuela_id || est.escuela_id || 1),
      items: Array.isArray(o.items_json)
        ? o.items_json
        : (typeof o.items_json === 'string' ? JSON.parse(o.items_json || '[]') : [])
    }));

    // 3. Recargas específicas
    const recargas = movimientos.filter(m => m.tipo && (m.tipo.startsWith('recarga') || m.tipo === 'recarga_sinpe' || m.tipo === 'recarga_manual'));

    // 4. Totales / KPIs históricos
    const totalRecargasRow = db.prepare(`
      SELECT COALESCE(SUM(monto_colones), 0) as total, COUNT(*) as cant
      FROM transacciones_saldo
      WHERE estudiante_id = ? AND tipo IN ('recarga_sinpe', 'recarga_manual') AND monto_colones > 0 AND (revertida IS NULL OR revertida = 0)
    `).get(estId) || { total: 0, cant: 0 };

    const totalComprasRow = db.prepare(`
      SELECT COALESCE(SUM(ABS(monto_colones)), 0) as total, COUNT(*) as cant
      FROM transacciones_saldo
      WHERE estudiante_id = ? AND monto_colones < 0 AND (revertida IS NULL OR revertida = 0)
    `).get(estId) || { total: 0, cant: 0 };

    const totalComprasEntregadas = compras.filter(o => o.estado === 'entregado').reduce((acc, o) => acc + (o.total_colones || 0), 0);
    const cantComprasReal = compras.filter(o => o.estado !== 'cancelado').length;

    res.json({
      estudiante: est,
      totales: {
        saldo_actual: est.saldo_colones || 0,
        total_recargas: Number(totalRecargasRow.total || 0),
        cant_recargas: Number(totalRecargasRow.cant || 0),
        total_compras: Number(totalComprasRow.total || totalComprasEntregadas || 0),
        cant_compras: Math.max(Number(totalComprasRow.cant || 0), cantComprasReal)
      },
      compras,
      recargas,
      movimientos
    });
  } catch (error) {
    console.error('Error en /api/developer/estudiantes/:id/kardex:', error);
    res.status(500).json({ error: error.message });
  }
});

// 1. Buscador universal multicriterio
app.get('/api/developer/sinpe/buscar', (req, res) => {
  try {
    const { q, estado, escuela_id, fecha, origen, limite } = req.query;
    const data = buscarSinpeUniversalDev({
      q: q || '',
      estado: estado || 'todas',
      escuelaId: escuela_id || null,
      fecha: fecha || 'todas',
      origen: origen || 'todas',
      limite: limite || 100
    });
    res.json({ exito: true, ...data });
  } catch (err) {
    console.error('Error en /api/developer/sinpe/buscar:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Aprobación forzada por Developer Master
app.post('/api/developer/sinpe/aprobar', (req, res) => {
  try {
    const { solicitud_id, motivo, usuario_id } = req.body;
    if (!solicitud_id) {
      return res.status(400).json({ error: 'solicitud_id es requerido' });
    }

    const resultado = forzarAprobarSolicitudDev({
      solicitudId: parseInt(solicitud_id, 10),
      usuarioId: usuario_id ? parseInt(usuario_id, 10) : null,
      motivo: motivo || 'Aprobado manualmente por Master Developer'
    });

    broadcastEvent('recarga_exitosa', resultado);
    broadcastEvent('estudiante_actualizado', { id: resultado.estudiante_id, saldo_colones: resultado.saldo_nuevo });
    broadcastEvent('saldo_actualizado', { id: resultado.estudiante_id, saldo_colones: resultado.saldo_nuevo });
    broadcastEvent('solicitud_sinpe_procesada', resultado);
    broadcastEvent('movimiento_registrado', resultado);

    res.json({ exito: true, resultado, mensaje: `¡Recarga de ₡${Number(resultado.monto).toLocaleString('es-CR')} acreditada con éxito!` });
  } catch (err) {
    console.error('Error en /api/developer/sinpe/aprobar:', err);
    res.status(400).json({ error: err.message });
  }
});

// 3. Rechazo de solicitud por Developer Master
app.post('/api/developer/sinpe/rechazar', (req, res) => {
  try {
    const { solicitud_id, motivo, usuario_id } = req.body;
    if (!solicitud_id) {
      return res.status(400).json({ error: 'solicitud_id es requerido' });
    }

    const resultado = rechazarSolicitudDev({
      solicitudId: parseInt(solicitud_id, 10),
      usuarioId: usuario_id ? parseInt(usuario_id, 10) : null,
      motivo: motivo || 'Comprobante no verificado o inválido'
    });

    broadcastEvent('sinpe_rechazado', resultado);
    broadcastEvent('solicitud_sinpe_procesada', resultado);
    broadcastEvent('movimiento_registrado', resultado);

    res.json({ exito: true, resultado, mensaje: 'Solicitud rechazada y registrada en auditoría con éxito.' });
  } catch (err) {
    console.error('Error en /api/developer/sinpe/rechazar:', err);
    res.status(400).json({ error: err.message });
  }
});

// 4. Vincular notificación bancaria huérfana a estudiante
app.post('/api/developer/sinpe/vincular-banco', (req, res) => {
  try {
    const { banco_tx_id, estudiante_id, usuario_id, notas } = req.body;
    if (!banco_tx_id || !estudiante_id) {
      return res.status(400).json({ error: 'banco_tx_id y estudiante_id son requeridos' });
    }

    const resultado = vincularBancoAEstudianteDev({
      bancoTxId: banco_tx_id,
      estudianteId: parseInt(estudiante_id, 10),
      usuarioId: usuario_id ? parseInt(usuario_id, 10) : null,
      notas: notas || null
    });

    broadcastEvent('recarga_exitosa', resultado);
    broadcastEvent('estudiante_actualizado', { id: resultado.estudiante_id, saldo_colones: resultado.saldo_nuevo });
    broadcastEvent('saldo_actualizado', { id: resultado.estudiante_id, saldo_colones: resultado.saldo_nuevo });
    broadcastEvent('solicitud_sinpe_procesada', resultado);
    broadcastEvent('movimiento_registrado', resultado);

    res.json({
      exito: true,
      resultado,
      mensaje: `¡Depósito bancario de ₡${Number(resultado.monto).toLocaleString('es-CR')} vinculado y acreditado con éxito a ${resultado.estudiante_nombre}! Saldo anterior: ₡${Number(resultado.saldo_anterior).toLocaleString('es-CR')} ➔ Nuevo saldo: ₡${Number(resultado.saldo_nuevo).toLocaleString('es-CR')}`
    });
  } catch (err) {
    console.error('Error en /api/developer/sinpe/vincular-banco:', err);
    res.status(400).json({ error: err.message });
  }
});

// Crear nuevo estudiante / usuario + carné QR (escalable a 5 dígitos y prefijos multi-negocio)
app.post('/api/admin/estudiantes', (req, res) => {
  try {
    const {
      nombre_completo, edad, grado, seccion, saldo_inicial,
      limite_diario_colones, alergias, pin_seguridad, padre_nombre,
      padre_telefono, prefijo, tipo_entidad
    } = req.body;

    if (!nombre_completo || !grado || !seccion) {
      return res.status(400).json({ error: 'Nombre completo, grado y sección son obligatorios' });
    }

    // Correlativo seguro basado en el último ID registrado (evita colisiones por borrado)
    const maxRow = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 as nextId FROM estudiantes').get();
    const nextSeq = maxRow ? (maxRow.nextId || maxRow.nextid || 1) : 1;

    // Resolver escuela y prefijo institucional
    let escuelaId = req.body.escuela_id ? parseInt(req.body.escuela_id, 10) : 1;
    let schoolPrefix = 'EST';
    try {
      const escRow = db.prepare('SELECT codigo FROM escuelas WHERE id = ?').get(escuelaId);
      if (escRow && escRow.codigo) schoolPrefix = escRow.codigo;
    } catch (e) {}

    // Prefijo institucional configurable (ej: SJT, ESC01, o prefijos de perfil EMP, EVT, SOC)
    let finalPrefix = schoolPrefix;
    if (prefijo && prefijo !== 'EST') {
      finalPrefix = prefijo;
    } else if (tipo_entidad && tipo_entidad !== 'EST') {
      finalPrefix = tipo_entidad;
    }
    const cleanPrefix = (finalPrefix || schoolPrefix || 'EST').toUpperCase().trim().replace(/[^A-Z0-9]/g, '').substring(0, 6) || 'EST';
    const year = new Date().getFullYear();
    const codigoEstudiante = `${cleanPrefix}-${year}-${String(nextSeq).padStart(5, '0')}`;
    
    const primerNombre = nombre_completo.trim().split(' ')[0].toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const randomHex = Math.random().toString(16).substring(2, 6).toUpperCase();
    const qrToken = `QR-${cleanPrefix}-${primerNombre}-${year}-${String(nextSeq).padStart(5, '0')}-${randomHex}`;

    const pin = pin_seguridad ? String(pin_seguridad).trim() : '1234';
    const saldo = parseInt(saldo_inicial, 10) || 0;
    const limite = parseInt(limite_diario_colones, 10) || 3000;
    const edadNum = parseInt(edad, 10) || 8;
    const foto = null;
    const defaultCardTheme = getCardThemePredeterminado();

    const resEst = db.prepare(`
      INSERT INTO estudiantes 
      (codigo_estudiante, nombre_completo, edad, grado, seccion, qr_token, pin_seguridad, foto_url, saldo_colones, limite_diario_colones, alergias, padre_nombre, padre_telefono, permitir_transferencias, tarjeta_bloqueada, activo, escuela_id, card_theme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 1, ?, ?)
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
      padre_telefono || '',
      escuelaId,
      defaultCardTheme
    );

    const nuevoId = resEst.lastInsertRowid || resEst.id;

    // Crear cuenta de usuario estudiante
    const usernameEst = primerNombre.toLowerCase() + nextSeq;
    try {
      const userRes = db.prepare(`
        INSERT INTO usuarios (username, password_hash, rol, nombre, email, telefono, activo, escuela_id, card_theme)
        VALUES (?, ?, 'estudiante', ?, '', '', 1, ?, ?)
      `).run(usernameEst, pin, nombre_completo.trim(), escuelaId, defaultCardTheme);
      db.prepare('UPDATE estudiantes SET usuario_id = ? WHERE id = ?').run(userRes.lastInsertRowid || userRes.id, nuevoId);
    } catch (e) {}

    // Si tiene saldo inicial, registrar en movimientos
    if (saldo > 0) {
      db.prepare(`
        INSERT INTO transacciones_saldo 
        (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, descripcion, escuela_id)
        VALUES (?, 'recarga_manual', ?, 0, ?, 'Saldo inicial asignado por administración', ?)
      `).run(nuevoId, saldo, saldo, escuelaId);
    }

    const creado = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(nuevoId);
    broadcastEvent('estudiante_creado', creado);

    res.status(201).json({ ...creado, username_creado: usernameEst, pin_creado: pin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bloquear / Desbloquear tarjeta de estudiante
app.put('/api/admin/estudiantes/:id/bloquear', (req, res) => {
  try {
    const { tarjeta_bloqueada, escuela_id } = req.body;
    const estId = req.params.id;

    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estId);
    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado' });

    const targetEscuelaId = escuela_id ? parseInt(escuela_id, 10) : null;
    if (targetEscuelaId && est.escuela_id && est.escuela_id !== targetEscuelaId) {
      return res.status(403).json({ error: 'No tienes permisos para modificar un estudiante de otra escuela.' });
    }

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
    const { monto, descripcion, metodo, escuela_id } = req.body;
    const estudianteId = parseInt(req.params.id, 10);
    const montoColones = parseInt(monto, 10);

    if (isNaN(montoColones) || montoColones <= 0) {
      return res.status(400).json({ error: 'El monto a cargar debe ser mayor a ₡0' });
    }

    const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(estudianteId);
    if (!est) return res.status(404).json({ error: 'Estudiante no encontrado' });

    const targetEscuelaId = escuela_id ? parseInt(escuela_id, 10) : null;
    if (targetEscuelaId && est.escuela_id && est.escuela_id !== targetEscuelaId) {
      return res.status(403).json({ error: 'No tienes permisos para recargar a un estudiante de otra escuela.' });
    }

    const nuevoSaldo = est.saldo_colones + montoColones;
    db.prepare('UPDATE estudiantes SET saldo_colones = ? WHERE id = ?').run(nuevoSaldo, estudianteId);

    const descFinal = descripcion || `Carga en efectivo en la soda escolar (${metodo || 'Caja'})`;

    db.prepare(`
      INSERT INTO transacciones_saldo 
      (estudiante_id, tipo, monto_colones, saldo_previo, saldo_posterior, comprobante_sinpe, descripcion, escuela_id)
      VALUES (?, 'recarga_manual', ?, ?, ?, 'CAJA-SODA', ?, ?)
    `).run(estudianteId, montoColones, est.saldo_colones, nuevoSaldo, descFinal, est.escuela_id || 1);

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

// Listar historial de movimientos y transacciones con estado de reversión
app.get('/api/admin/movimientos', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;

    let query = `
      SELECT 
        t.*,
        ROUND((strftime('%s', 'now') - strftime('%s', t.fecha)) / 60.0, 1) as minutos_transcurridos,
        e.nombre_completo as estudiante_nombre,
        e.codigo_estudiante,
        e.grado,
        e.seccion,
        e.foto_url as estudiante_foto,
        e.saldo_colones as estudiante_saldo_actual,
        u.nombre as revertido_por_nombre,
        o.codigo_orden
      FROM transacciones_saldo t
      JOIN estudiantes e ON t.estudiante_id = e.id
      LEFT JOIN usuarios u ON t.revertido_por_usuario_id = u.id
      LEFT JOIN ordenes o ON t.orden_id = o.id
    `;
    const params = [];
    if (escuelaId) {
      query += ` WHERE (e.escuela_id = ? OR t.escuela_id = ?) `;
      params.push(escuelaId, escuelaId);
    }
    query += ` ORDER BY t.fecha DESC, t.id DESC LIMIT ?`;
    params.push(limit);

    const movimientos = db.prepare(query).all(...params);

    res.json(movimientos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Revertir un movimiento (recarga o cobro erróneo)
app.post('/api/admin/movimientos/:id/revertir', (req, res) => {
  try {
    const transaccionId = parseInt(req.params.id, 10);
    const { usuario_id, usuario_rol, escuela_id } = req.body;

    if (!transaccionId || isNaN(transaccionId)) {
      return res.status(400).json({ error: 'ID de transacción inválido' });
    }

    const resultado = revertirTransaccionSaldoTransaction({
      transaccionId,
      usuarioId: usuario_id || null,
      usuarioRol: usuario_rol || 'admin',
      escuelaId: escuela_id ? parseInt(escuela_id, 10) : null
    });

    // Notificaciones en vivo (SSE) para reflejar saldo en portal de padres, PWA y terminal
    broadcastEvent('saldo_actualizado', {
      id: resultado.estudiante_id,
      estudiante_id: resultado.estudiante_id,
      saldo_colones: resultado.saldo_nuevo
    });
    broadcastEvent('estudiante_actualizado', {
      id: resultado.estudiante_id,
      estudiante_id: resultado.estudiante_id,
      saldo_colones: resultado.saldo_nuevo
    });
    broadcastEvent('movimiento_revertido', resultado);

    if (resultado.productos_restaurados && resultado.productos_restaurados.length > 0) {
      broadcastEvent('inventario_actualizado', { motivo: 'reversion_orden' });
    }

    res.json(resultado);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// EXPORTACIÓN A EXCEL / CSV (ADMIN SODA)
// ==========================================
let XLSX = null;
try {
  XLSX = require('xlsx');
} catch (e) {
  console.warn('Módulo XLSX no disponible, usando fallback CSV:', e.message);
}

function generarExcelWorkbook(sheetName, headers, rows) {
  if (!XLSX) return null;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Auto-ajuste de anchos de columna para que el texto nunca salga cortado
  ws['!cols'] = headers.map((h, i) => {
    let maxLen = String(h || '').length;
    for (let r = 0; r < Math.min(rows.length, 500); r++) {
      const val = rows[r] && rows[r][i] !== undefined && rows[r][i] !== null ? String(rows[r][i]) : '';
      if (val.length > maxLen) maxLen = val.length;
    }
    return { wch: Math.min(Math.max(maxLen + 3, 14), 45) };
  });

  XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function arrayToCsv(headers, rows) {
  const escapeCell = (cell) => {
    if (cell === null || cell === undefined) return '';
    const str = String(cell);
    if (str.includes(';') || str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const headerLine = headers.map(escapeCell).join(';');
  const rowLines = rows.map(r => r.map(escapeCell).join(';'));
  // UTF-8 BOM puro (\uFEFF) sin "sep=;" (el sep=; provocaba que Excel cambiara la codificación a ANSI y rompiera los acentos)
  return '\uFEFF' + [headerLine, ...rowLines].join('\r\n');
}

function responderExportacion(res, req, { sheetName, filenameBase, headers, rows }) {
  const isCsvRequested = req.path.endsWith('.csv');

  // Si no se pide explícitamente .csv y XLSX está disponible, generar archivo nativo .xlsx
  if (!isCsvRequested && XLSX) {
    try {
      const buf = generarExcelWorkbook(sheetName, headers, rows);
      if (buf) {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
        return res.send(buf);
      }
    } catch (err) {
      console.error('Error generando XLSX, recurriendo a CSV:', err);
    }
  }

  // Fallback a CSV limpio
  const csvOutput = arrayToCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
  return res.send(csvOutput);
}

// Exportar Ventas a Excel / CSV
app.get(['/api/admin/export/ventas.xlsx', '/api/admin/export/ventas.csv'], (req, res) => {
  try {
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    let query = `
      SELECT o.id, o.codigo_orden, o.tipo_orden, o.momento_entrega, o.total_colones, o.estado, o.creado_en,
             e.nombre_completo as estudiante_nombre, e.codigo_estudiante
      FROM ordenes o
      JOIN estudiantes e ON o.estudiante_id = e.id
    `;
    const params = [];
    if (escuelaId) {
      query += ` WHERE (o.escuela_id = ? OR e.escuela_id = ?) `;
      params.push(escuelaId, escuelaId);
    }
    query += ` ORDER BY o.id DESC LIMIT 3000`;

    const ordenes = db.prepare(query).all(...params);

    const headers = ['Fecha y Hora', 'Código Orden', 'Estudiante', 'Código Est.', 'Tipo Orden', 'Horario Entrega', 'Total (CRC)', 'Estado'];
    const rows = ordenes.map(o => {
      const fechaFmt = o.creado_en ? new Date(o.creado_en).toLocaleString('es-CR') : '';
      return [
        fechaFmt,
        o.codigo_orden,
        o.estudiante_nombre,
        o.codigo_estudiante,
        o.tipo_orden === 'preorden' ? 'Pre-orden' : 'Mostrador',
        o.momento_entrega || 'Inmediato',
        Number(o.total_colones || 0),
        o.estado
      ];
    });

    const filenameBase = `ventas_sibopay_${new Date().toISOString().slice(0, 10)}`;
    responderExportacion(res, req, { sheetName: 'Ventas', filenameBase, headers, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Exportar Saldos de Estudiantes a Excel / CSV
app.get(['/api/admin/export/estudiantes.xlsx', '/api/admin/export/estudiantes.csv'], (req, res) => {
  try {
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    let query = `
      SELECT e.codigo_estudiante, e.nombre_completo, e.grado, e.seccion,
             e.saldo_colones, e.limite_diario_colones, e.alergias, e.bloquear_chucherias,
             e.padre_nombre, e.padre_telefono, e.activo, esc.nombre as escuela_nombre
      FROM estudiantes e
      LEFT JOIN escuelas esc ON e.escuela_id = esc.id
    `;
    const params = [];
    if (escuelaId) {
      query += ` WHERE e.escuela_id = ? `;
      params.push(escuelaId);
    }
    query += ` ORDER BY e.nombre_completo ASC`;

    const rowsDb = db.prepare(query).all(...params);
    const headers = ['Código Estudiante', 'Nombre Completo', 'Grado', 'Sección', 'Saldo Actual (CRC)', 'Límite Diario (CRC)', 'Alergias / Salud', 'Veto Chatarra', 'Encargado / Padre', 'Teléfono Padre', 'Sede Escolar', 'Estado'];

    const rows = rowsDb.map(r => [
      r.codigo_estudiante,
      r.nombre_completo,
      r.grado || '',
      r.seccion || '',
      Number(r.saldo_colones || 0),
      Number(r.limite_diario_colones || 3000),
      r.alergias || 'Ninguna conocida',
      r.bloquear_chucherias ? 'SÍ (Veto Activo)' : 'NO',
      r.padre_nombre || '',
      r.padre_telefono || '',
      r.escuela_nombre || 'Sede Central',
      r.activo ? 'Activo' : 'Bloqueado'
    ]);

    const filenameBase = `estudiantes_saldos_sibopay_${new Date().toISOString().slice(0, 10)}`;
    responderExportacion(res, req, { sheetName: 'Saldos Estudiantes', filenameBase, headers, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Exportar Recargas y Depósitos SINPE a Excel / CSV
app.get(['/api/admin/export/recargas.xlsx', '/api/admin/export/recargas.csv'], (req, res) => {
  try {
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    const { desde, hasta, estado } = req.query;

    let query = `
      SELECT s.id, s.creado_en, s.comprobante_sinpe, s.codigo_detalle, s.monto_colones, s.estado, s.notas,
             e.codigo_estudiante, e.nombre_completo as estudiante_nombre, e.grado, e.seccion,
             COALESCE(u.nombre, e.padre_nombre) as padre_nombre,
             COALESCE(u.telefono, e.padre_telefono) as padre_telefono,
             u_aprob.nombre as aprobado_por_nombre
      FROM solicitudes_recarga_sinpe s
      JOIN estudiantes e ON s.estudiante_id = e.id
      LEFT JOIN usuarios u ON s.padre_usuario_id = u.id
      LEFT JOIN usuarios u_aprob ON s.aprobado_por_usuario_id = u_aprob.id
      WHERE 1=1
    `;
    const params = [];

    if (escuelaId) {
      query += ` AND s.escuela_id = ? `;
      params.push(escuelaId);
    }

    if (desde && desde.trim()) {
      query += ` AND s.creado_en >= ? `;
      params.push(`${desde.trim()} 00:00:00`);
    }

    if (hasta && hasta.trim()) {
      query += ` AND s.creado_en <= ? `;
      params.push(`${hasta.trim()} 23:59:59`);
    }

    if (estado && estado.trim() && estado.trim() !== 'todos') {
      query += ` AND s.estado = ? `;
      params.push(estado.trim());
    }

    query += ` ORDER BY s.id DESC LIMIT 5000`;

    const recargas = db.prepare(query).all(...params);

    const headers = [
      'ID Solicitud',
      'Fecha y Hora',
      'Comprobante SINPE',
      'Código Verificación',
      'Estudiante',
      'Carné Estudiante',
      'Grado y Sección',
      'Padre / Tutor',
      'Teléfono Padre',
      'Monto (CRC)',
      'Estado',
      'Verificado Por',
      'Notas'
    ];

    const rows = recargas.map(r => {
      const fechaFmt = r.creado_en ? new Date(r.creado_en).toLocaleString('es-CR') : '';
      const gradoSeccion = [r.grado, r.seccion].filter(Boolean).join(' - ') || 'N/A';
      let estLabel = r.estado;
      if (r.estado === 'aprobada' || r.estado === 'aprobado') estLabel = 'Aprobada / Acreditada';
      else if (r.estado === 'rechazada' || r.estado === 'rechazado') estLabel = 'Rechazada';
      else if (r.estado === 'pendiente') estLabel = 'Pendiente de Verificación';

      return [
        r.id,
        fechaFmt,
        r.comprobante_sinpe || '',
        r.codigo_detalle || '',
        r.estudiante_nombre || '',
        r.codigo_estudiante || '',
        gradoSeccion,
        r.padre_nombre || 'Padre de Familia',
        r.padre_telefono || '',
        Number(r.monto_colones || 0),
        estLabel,
        r.aprobado_por_nombre || ((r.estado === 'aprobada' || r.estado === 'aprobado') ? 'Sistema / Cajero' : ''),
        r.notas || ''
      ];
    });

    const dateTag = desde ? `${desde}_a_${hasta || desde}` : new Date().toISOString().slice(0, 10);
    const filenameBase = `recargas_sinpe_sibopay_${dateTag}`;
    responderExportacion(res, req, { sheetName: 'Recargas SINPE', filenameBase, headers, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener Horarios de Recreos y Almuerzo de la Escuela
app.get('/api/escuela/horarios', (req, res) => {
  try {
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : 1;
    const horarios = obtenerHorariosEscuela(escuelaId);
    res.json({ success: true, horarios });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modificar Horarios de Recreos y Almuerzo de la Escuela (Admin)
app.put('/api/admin/escuela/horarios', (req, res) => {
  try {
    const { escuela_id, hora_recreo_1, hora_almuerzo, hora_recreo_2 } = req.body;
    const escuelaId = escuela_id ? parseInt(escuela_id, 10) : 1;
    const actualizados = actualizarHorariosEscuela(escuelaId, {
      hora_recreo_1,
      hora_almuerzo,
      hora_recreo_2
    });

    // Notificar en tiempo real por SSE
    broadcastEvent('horarios_actualizados', actualizados);

    res.json({ 
      success: true, 
      message: 'Horarios escolares actualizados correctamente', 
      horarios: actualizados 
    });
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
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    let sql = `
      SELECT e.*, 
        COALESCE((
          SELECT SUM(ABS(monto_colones)) 
          FROM transacciones_saldo 
          WHERE estudiante_id = e.id AND monto_colones < 0 
            AND date(fecha, 'localtime') = date('now', 'localtime')
        ), 0) as gastado_hoy
      FROM estudiantes e 
      WHERE activo = 1 
    `;
    const params = [];
    if (escuelaId) {
      sql += ' AND e.escuela_id = ?';
      params.push(escuelaId);
    }
    sql += ' ORDER BY grado, seccion, nombre_completo';
    const list = db.prepare(sql).all(...params);
    const listWithDisp = list.map(e => enriquecerEstudianteFinanzas(e));
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

    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    if (escuelaId && est.escuela_id && est.escuela_id !== escuelaId) {
      return res.status(403).json({ error: 'No tienes permisos para consultar estudiantes de otra escuela.' });
    }

    const finanzas = enriquecerEstudianteFinanzas(est);

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
      ...finanzas,
      transacciones,
      ordenes_activas: ordenesActivas
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Buscar estudiante por código QR (Ultra rápido para terminal de caja y recargas)
app.get('/api/estudiantes/qr/:token', (req, res) => {
  try {
    const { token } = req.params;
    let raw = decodeURIComponent(String(token || '')).trim();
    raw = raw.replace(/^["'`]+|["'`]+$/g, '').trim();

    // Si viene como JSON
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const parsed = JSON.parse(raw);
        raw = parsed.qr_token || parsed.token || parsed.codigo_estudiante || parsed.codigo || parsed.id || raw;
      } catch (e) {}
    }

    // Si viene como URL o ruta (ej: carnet.html?id=2 o /api/qr-image/QR-...)
    let queryId = null;
    if (typeof raw === 'string' && (raw.includes('http://') || raw.includes('https://') || raw.includes('carnet.html') || raw.includes('/'))) {
      const matchId = raw.match(/[?&]id=(\d+)/i);
      if (matchId) queryId = parseInt(matchId[1], 10);

      const matchParam = raw.match(/[?&](?:qr|token|code)=([^&#]+)/i);
      if (matchParam) {
        raw = decodeURIComponent(matchParam[1]).trim();
      } else {
        const parts = raw.split(/[/?#]/).filter(Boolean);
        const lastPart = parts[parts.length - 1];
        if (lastPart && !lastPart.endsWith('.html') && !lastPart.includes('=')) {
          raw = lastPart;
        }
      }
    }

    const cleanToken = String(raw).trim();
    const asInt = parseInt(cleanToken, 10);
    const validIntId = (!isNaN(asInt) && String(asInt) === cleanToken) ? asInt : (queryId || -1);

    const est = db.prepare(`
      SELECT * FROM estudiantes 
      WHERE qr_token = ? 
         OR LOWER(qr_token) = LOWER(?)
         OR codigo_estudiante = ? 
         OR LOWER(codigo_estudiante) = LOWER(?)
         OR id = ?
      LIMIT 1
    `).get(cleanToken, cleanToken, cleanToken, cleanToken, validIntId);

    if (!est) {
      return res.status(404).json({ error: 'Código QR no reconocido en la base de datos de la escuela' });
    }

    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    if (escuelaId && est.escuela_id && est.escuela_id !== escuelaId) {
      return res.status(403).json({ error: '⛔ Este estudiante pertenece a otra institución escolar.' });
    }

    const finanzas = enriquecerEstudianteFinanzas(est);

    // Verificar si tiene pre-órdenes listas para retirar en el recreo
    const preordenesPendientes = db.prepare(`
      SELECT o.*, 
        (SELECT json_group_array(json_object('nombre', COALESCE(d.nombre_producto, p.nombre), 'cantidad', d.cantidad, 'precio', d.precio_unitario))
         FROM orden_detalles d LEFT JOIN productos p ON d.producto_id = p.id WHERE d.orden_id = o.id) as items_json
      FROM ordenes o
      WHERE o.estudiante_id = ? AND o.tipo_orden = 'preorden' AND o.estado IN ('pendiente', 'en_preparacion', 'listo')
      ORDER BY o.creado_en ASC
    `).all(est.id);

    const preordenesFormateadas = preordenesPendientes.map(o => ({
      ...o,
      items: Array.isArray(o.items_json)
        ? o.items_json
        : (typeof o.items_json === 'string' ? JSON.parse(o.items_json || '[]') : [])
    }));

    res.json({
      ...finanzas,
      preordenes_pendientes: preordenesFormateadas
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generar imagen QR en PNG/SVG para el carné
app.get('/api/qr-image/:token', async (req, res) => {
  try {
    const rawToken = req.params.token;
    const est = db.prepare('SELECT * FROM estudiantes WHERE qr_token = ? OR codigo_estudiante = ?').get(rawToken, rawToken);

    // Si el estudiante existe y su QR está bloqueado por superar límite diario (sin pre-órdenes pendientes)
    if (est && !req.query.bypass) {
      const finanzas = enriquecerEstudianteFinanzas(est);
      if (finanzas.qr_bloqueado) {
        return res.status(403).json({
          error: 'Código QR bloqueado: Límite diario alcanzado y no hay pre-órdenes pendientes para retirar.',
          bloqueado: true,
          limite_diario: finanzas.limite_diario_colones,
          disponible_hoy: finanzas.disponible_hoy
        });
      }
    }

    const qrDataUrl = await QRCode.toDataURL(rawToken, {
      width: 350,
      margin: 3,
      errorCorrectionLevel: 'H',
      color: {
        dark: '#000000',
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

// ==========================================
// SOLICITUDES DE RECARGA SINPE MÓVIL (PORTAL PADRES & SODA)
// ==========================================

// 0. Generar código de detalle único para recarga SINPE
app.post('/api/sinpe/generar-codigo', (req, res) => {
  try {
    const { estudiante_id, monto } = req.body;
    const codigo = generarCodigoDetalleSinpe();
    let telefono_sinpe = '8888-8888';
    let titular_sinpe = 'Soda Escolar';
    let escuela_nombre = 'Soda Escolar';

    if (estudiante_id) {
      const est = db.prepare(`
        SELECT e.id, esc.telefono_sinpe, esc.nombre_sinpe, esc.nombre as escuela_nombre
        FROM estudiantes e
        LEFT JOIN escuelas esc ON esc.id = e.escuela_id
        WHERE e.id = ?
      `).get(estudiante_id);
      if (est) {
        if (est.telefono_sinpe) telefono_sinpe = est.telefono_sinpe;
        if (est.nombre_sinpe) titular_sinpe = est.nombre_sinpe;
        if (est.escuela_nombre) escuela_nombre = est.escuela_nombre;
      }
    }

    res.json({
      success: true,
      codigo,
      telefono_sinpe,
      titular_sinpe,
      escuela_nombre
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 1. Crear solicitud de recarga (enviada por el padre)
app.post('/api/sinpe/solicitar', (req, res) => {
  try {
    const { estudiante_id, padre_usuario_id, monto, comprobante, codigo_detalle, notas } = req.body;
    if (!estudiante_id) return res.status(400).json({ error: 'Estudiante no especificado' });
    const montoNum = parseInt(monto, 10);
    if (isNaN(montoNum) || montoNum <= 0) {
      return res.status(400).json({ error: 'Ingresa un monto válido mayor a ₡0' });
    }
    const cleanComp = String(comprobante || '').trim();
    const cleanCod = codigo_detalle ? String(codigo_detalle).trim() : null;
    if (!cleanComp && !cleanCod) {
      return res.status(400).json({ error: 'Debes ingresar el comprobante o código de detalle SINPE' });
    }

    const nuevaSol = crearSolicitudRecargaSinpe({
      estudianteId: parseInt(estudiante_id, 10),
      padreUsuarioId: padre_usuario_id ? parseInt(padre_usuario_id, 10) : null,
      monto: montoNum,
      comprobante: cleanComp || (cleanCod ? `SINPE-${cleanCod}` : ''),
      codigoDetalle: cleanCod,
      notas
    });

    const estudiante = db.prepare('SELECT nombre_completo, grado, seccion, foto_url FROM estudiantes WHERE id = ?').get(estudiante_id);

    const payloadNotificacion = {
      ...nuevaSol,
      estudiante_nombre: estudiante ? estudiante.nombre_completo : 'Estudiante',
      estudiante_grado: estudiante ? estudiante.grado : '',
      estudiante_seccion: estudiante ? estudiante.seccion : '',
      estudiante_foto: estudiante ? estudiante.foto_url : ''
    };

    broadcastEvent('solicitud_sinpe_nueva', payloadNotificacion);

    // Enviar notificación Web Push a dispositivos suscritos (funciona con la app 100% cerrada)
    const montoFmt = Number(payloadNotificacion.monto_colones || montoNum).toLocaleString('es-CR');
    sendWebPushNotification({
      escuelaId: nuevaSol.escuela_id || 1,
      payload: {
        title: '🔔 Nueva Recarga SINPE - SiboPay',
        body: `Recarga de ₡${montoFmt} para ${payloadNotificacion.estudiante_nombre}. Detalle: ${payloadNotificacion.codigo_detalle || payloadNotificacion.comprobante_sinpe}`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `sinpe-${payloadNotificacion.id || Date.now()}`,
        data: { url: '/pos.html?tab=sinpe' }
      }
    });

    res.json({
      success: true,
      mensaje: 'Solicitud de recarga enviada.',
      solicitud: payloadNotificacion
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 1b. Validar SINPE en tiempo real por correo bancario
app.post('/api/sinpe/validar', async (req, res) => {
  try {
    const { estudiante_id, monto, codigo, comprobante, solicitud_id, padre_usuario_id } = req.body;
    if (!estudiante_id) return res.status(400).json({ error: 'Estudiante no especificado' });
    const montoNum = parseInt(monto, 10);
    if (isNaN(montoNum) || montoNum <= 0) {
      return res.status(400).json({ error: 'Ingresa un monto válido mayor a ₡0' });
    }

    const cleanCod = codigo ? String(codigo).trim() : null;
    const cleanComp = comprobante ? String(comprobante).trim() : null;

    if (!cleanCod && !cleanComp) {
      return res.status(400).json({ error: 'Se requiere el código de detalle (ej. SIBO-XXXX) o el número de comprobante para validar.' });
    }

    // 1. Escaneo en caliente del buzón IMAP (si está configurado)
    try {
      await checkSinpeEmailsOnce(db);
    } catch (scanErr) {
      console.warn('⚠️ [SINPE Validar] Error en escaneo IMAP caliente:', scanErr.message);
    }

    // 2. Buscar en las transacciones registradas
    const busqueda = buscarTransaccionSinpeBanco({
      codigoDetalle: cleanCod,
      comprobante: cleanComp,
      monto: montoNum
    });

    if (busqueda.error) {
      return res.status(400).json({
        success: false,
        verificado: false,
        error: busqueda.error,
        message: busqueda.mensaje
      });
    }

    if (busqueda.encontrado && busqueda.tx) {
      const tx = busqueda.tx;
      marcarTransaccionSinpeUsada(tx.id, estudiante_id);

      let resultadoAprobacion = null;
      if (solicitud_id) {
        try {
          resultadoAprobacion = procesarSolicitudRecargaSinpe({
            solicitudId: parseInt(solicitud_id, 10),
            accion: 'aprobar',
            usuarioId: null,
            motivo: `Validación automática por correo (${tx.origin_bank} - Ref #${tx.reference_number || tx.codigo_detalle})`
          });
        } catch (_) {}
      }

      if (!resultadoAprobacion) {
        resultadoAprobacion = recargaSaldoTransaction({
          estudianteId: parseInt(estudiante_id, 10),
          monto: montoNum,
          comprobanteSinpe: tx.reference_number || cleanComp || tx.codigo_detalle,
          descripcion: `Recarga SINPE verificada automáticamente por correo (${tx.origin_bank} Ref #${tx.reference_number || tx.codigo_detalle})`
        });
      }

      const est = db.prepare('SELECT nombre_completo, saldo_colones FROM estudiantes WHERE id = ?').get(estudiante_id);
      const nuevoSaldo = est ? est.saldo_colones : (resultadoAprobacion.saldo_nuevo || montoNum);

      broadcastEvent('recarga_exitosa', {
        estudiante_id,
        monto: montoNum,
        saldo_nuevo: nuevoSaldo,
        origen_banco: tx.origin_bank,
        referencia: tx.reference_number
      });
      broadcastEvent('saldo_actualizado', { id: estudiante_id, saldo_colones: nuevoSaldo });
      broadcastEvent('estudiante_actualizado', { id: estudiante_id, saldo_colones: nuevoSaldo });

      console.log(`🎉 [SINPE Validado] ₡${montoNum} acreditados a estudiante #${estudiante_id} vía ${tx.origin_bank} (Ref #${tx.reference_number})`);

      return res.json({
        success: true,
        verificado: true,
        monto: montoNum,
        banco: tx.origin_bank,
        comprobante: tx.reference_number,
        codigo: tx.codigo_detalle,
        saldo_nuevo: nuevoSaldo,
        mensaje: `🎉 ¡Pago verificado con éxito! Se acreditaron ₡${montoNum.toLocaleString('es-CR')} de ${tx.origin_bank}.`
      });
    }

    // Si aún no se detectó el correo
    return res.json({
      success: false,
      verificado: false,
      retry: true,
      mensaje: `⏳ Aún no detectamos la notificación del banco en el correo. Si acabas de realizar la transferencia, espera unos 10-15 segundos a que el banco emita el comprobante y presiona "Validar SINPE" nuevamente.`
    });
  } catch (error) {
    console.error('Error en /api/sinpe/validar:', error);
    res.status(500).json({ error: error.message });
  }
});

// 1c. Simular correo bancario entrante (para pruebas y demos)
app.post('/api/sinpe/simular-correo', (req, res) => {
  try {
    const { codigo, monto, banco, remitente, telefono, comprobante } = req.body;
    if (!monto) return res.status(400).json({ error: 'Monto es requerido' });
    const tx = simularSinpeEmail(db, { codigo, monto, banco, remitente, telefono, comprobante });
    res.json({ success: true, mensaje: 'Transacción simulada registrada exitosamente', tx });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 1d. Webhook receptor en el aire para Cloudflare Email Routing / Worker
app.post('/api/sinpe/webhook-email', express.text({ type: ['text/*', 'application/json', '*/*'], limit: '25mb' }), async (req, res) => {
  try {
    const rawData = req.body;
    let subject = '';
    let bodyText = '';
    let bodyHtml = '';
    let from = '';

    if (typeof rawData === 'string') {
      try {
        const parsed = await simpleParser(rawData);
        subject = parsed.subject || '';
        bodyText = parsed.text || '';
        bodyHtml = parsed.html || '';
        from = parsed.from ? parsed.from.text : '';
      } catch (e) {
        bodyText = rawData;
      }
      if (!bodyText && !bodyHtml) {
        bodyText = rawData;
      } else {
        bodyText = `${bodyText}\n${rawData}`;
      }
    } else if (typeof rawData === 'object' && rawData !== null) {
      subject = rawData.subject || '';
      bodyText = rawData.text || rawData.body || '';
      from = rawData.from || '';
    }

    const parsedSinpe = parseSinpeEmail(subject, bodyText, bodyHtml, from);

    if (parsedSinpe.isSinpe && parsedSinpe.amountCrc > 0) {
      const txId = `sinpe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const normCod = parsedSinpe.codigoDetalleNormalizado || '';
      const refNum = parsedSinpe.referenceNumber || (normCod ? `REF-${normCod}` : `TX-${Date.now()}`);

      // Evitar duplicados exactos: solo si el código ya fue recibido previamente
      const existing = db.prepare(`
        SELECT id FROM sinpe_transacciones_banco 
        WHERE (codigo_detalle_norm = ? AND codigo_detalle_norm IS NOT NULL AND codigo_detalle_norm != '')
           OR (reference_number = ? AND reference_number IS NOT NULL AND codigo_detalle_norm = ?)
        LIMIT 1
      `).get(normCod || '__none__', refNum, normCod || '__none__');

      if (!existing) {
        db.prepare(`
          INSERT INTO sinpe_transacciones_banco 
            (id, reference_number, codigo_detalle, codigo_detalle_norm, amount_crc, sender_phone, sender_name, origin_bank, status, raw_data)
          VALUES 
            (?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', ?)
        `).run(
          txId,
          refNum,
          parsedSinpe.codigoDetalle || null,
          normCod || null,
          parsedSinpe.amountCrc,
          parsedSinpe.senderPhone || null,
          parsedSinpe.senderName || 'Cliente SINPE',
          parsedSinpe.originBank || 'SINPE Móvil',
          JSON.stringify({ from, subject, summary: parsedSinpe.rawSummary, source: 'cloudflare_webhook' })
        );
        console.log(`⚡ [SINPE Webhook Cloudflare] Correo atrapado en el aire: ₡${parsedSinpe.amountCrc} | Cód: ${parsedSinpe.codigoDetalle || 'N/A'} | Ref: #${refNum} | Banco: ${parsedSinpe.originBank}`);

        // AUTO-CONCILIACIÓN INMEDIATA:
        // Si hay una solicitud pendiente con este código y monto, aprobarla al instante
        if (normCod || refNum) {
          try {
            const solPendiente = db.prepare(`
              SELECT id, estudiante_id, monto_colones, codigo_detalle, comprobante_sinpe 
              FROM solicitudes_recarga_sinpe 
              WHERE estado = 'pendiente' 
                AND (
                  (codigo_detalle IS NOT NULL AND (codigo_detalle = ? OR UPPER(REPLACE(REPLACE(codigo_detalle, '-', ''), ' ', '')) = ?))
                  OR (comprobante_sinpe IS NOT NULL AND (comprobante_sinpe = ? OR comprobante_sinpe = ? OR comprobante_sinpe LIKE ?))
                )
              ORDER BY creado_en DESC LIMIT 1
            `).get(
              parsedSinpe.codigoDetalle || '__none__',
              normCod || '__none__',
              refNum,
              `SINPE-${parsedSinpe.codigoDetalle}`,
              `%${refNum}%`
            );

            if (solPendiente && Math.abs(Number(solPendiente.monto_colones) - parsedSinpe.amountCrc) < 0.01) {
              marcarTransaccionSinpeUsada(txId, solPendiente.estudiante_id);
              procesarSolicitudRecargaSinpe({
                solicitudId: solPendiente.id,
                accion: 'aprobar',
                usuarioId: null,
                motivo: `Validación automática por correo (${parsedSinpe.originBank} Ref #${refNum})`
              });

              const est = db.prepare('SELECT saldo_colones FROM estudiantes WHERE id = ?').get(solPendiente.estudiante_id);
              const nuevoSaldo = est ? est.saldo_colones : parsedSinpe.amountCrc;

              broadcastEvent('recarga_exitosa', {
                estudiante_id: solPendiente.estudiante_id,
                monto: parsedSinpe.amountCrc,
                saldo_nuevo: nuevoSaldo,
                origen_banco: parsedSinpe.originBank,
                referencia: refNum
              });
              broadcastEvent('saldo_actualizado', { id: solPendiente.estudiante_id, saldo_colones: nuevoSaldo });
              broadcastEvent('estudiante_actualizado', { id: solPendiente.estudiante_id, saldo_colones: nuevoSaldo });
              broadcastEvent('solicitud_sinpe_procesada', { id: solPendiente.id, estado: 'aprobada' });

              console.log(`🎉 [SINPE Auto-Conciliado] Solicitud #${solPendiente.id} aprobada automáticamente al llegar el correo bancario (+₡${parsedSinpe.amountCrc} a estudiante #${solPendiente.estudiante_id})`);
            }
          } catch (autoErr) {
            console.warn('⚠️ Error en auto-conciliación de webhook:', autoErr.message);
          }
        }
      }
    }

    res.json({ success: true, parsed: parsedSinpe });
  } catch (error) {
    console.error('Error en /api/sinpe/webhook-email:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Listar solicitudes (para la soda/admin)
app.get('/api/sinpe/solicitudes', (req, res) => {
  try {
    const estado = req.query.estado || 'pendiente';
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    const solicitudes = obtenerSolicitudesRecargaSinpe(estado, escuelaId);
    res.json({ success: true, solicitudes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Listar solicitudes por estudiante (para el portal de padres)
app.get('/api/sinpe/solicitudes/estudiante/:id', (req, res) => {
  try {
    const solicitudes = obtenerSolicitudesRecargaPorEstudiante(parseInt(req.params.id, 10));
    res.json({ success: true, solicitudes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Procesar (aprobar o rechazar) solicitud de recarga desde la soda
app.post('/api/sinpe/procesar', (req, res) => {
  try {
    const { solicitud_id, accion, usuario_id, motivo } = req.body;
    if (!solicitud_id || !accion) {
      return res.status(400).json({ error: 'solicitud_id y accion son obligatorios' });
    }

    const escuelaId = req.body.escuela_id ? parseInt(req.body.escuela_id, 10) : null;
    const resultado = procesarSolicitudRecargaSinpe({
      solicitudId: parseInt(solicitud_id, 10),
      accion,
      usuarioId: usuario_id ? parseInt(usuario_id, 10) : null,
      motivo,
      escuelaId
    });

    if (resultado.estado === 'aprobada') {
      broadcastEvent('recarga_exitosa', resultado);
      broadcastEvent('estudiante_actualizado', { id: resultado.estudiante_id, saldo_colones: resultado.saldo_nuevo });
      broadcastEvent('saldo_actualizado', { id: resultado.estudiante_id, saldo_colones: resultado.saldo_nuevo });
    } else if (resultado.estado === 'rechazada') {
      broadcastEvent('sinpe_rechazado', resultado);
    }
    broadcastEvent('solicitud_sinpe_procesada', resultado);
    broadcastEvent('movimiento_registrado', resultado);

    res.json({ success: true, resultado });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ==========================================
// ENDPOINTS DE SUSCRIPCIÓN WEB PUSH (VAPID)
// ==========================================

// 1. Obtener la llave pública VAPID
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// 2. Registrar o renovar suscripción del dispositivo
app.post('/api/push/subscribe', (req, res) => {
  try {
    const { subscription, userId, rol, escuelaId } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Suscripción inválida' });
    }

    const { endpoint, keys } = subscription;
    const { p256dh, auth } = keys;

    if (!p256dh || !auth) {
      return res.status(400).json({ error: 'Faltan llaves de cifrado en la suscripción' });
    }

    guardarSuscripcionPush({
      endpoint,
      p256dh,
      auth,
      userId: userId ? parseInt(userId, 10) : null,
      rol: rol || 'cajero',
      escuelaId: escuelaId ? parseInt(escuelaId, 10) : 1
    });

    console.log(`[WebPush] Dispositivo suscrito con éxito (Rol: ${rol || 'cajero'})`);
    res.json({ success: true, message: 'Dispositivo suscrito a notificaciones push' });
  } catch (err) {
    console.error('Error suscribiendo push:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Cancelar suscripción
app.post('/api/push/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      eliminarSuscripcionPush(endpoint);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Enviar notificación de prueba a los dispositivos suscritos
app.post('/api/push/test', async (req, res) => {
  try {
    await sendWebPushNotification({
      payload: {
        title: '🔔 Prueba de Notificación - SiboPay',
        body: '¡Excelente! Las notificaciones funcionan en segundo plano incluso con la app cerrada.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'test-push',
        data: { url: '/pos.html?tab=sinpe' }
      }
    });
    res.json({ success: true, message: 'Notificación de prueba enviada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar configuración parental (Límite diario, restricciones y transferencias P2P)
app.put('/api/estudiantes/:id/limite', (req, res) => {
  try {
    const { limite_diario_colones, alergias, bloquear_chucherias, permitir_transferencias, bloqueo_qr_biometrico } = req.body;
    const estId = req.params.id;

    const bioVal = bloqueo_qr_biometrico !== undefined
      ? (Number(bloqueo_qr_biometrico) === 1 || bloqueo_qr_biometrico === true || bloqueo_qr_biometrico === '1' ? 1 : 0)
      : null;

    db.prepare(`
      UPDATE estudiantes 
      SET limite_diario_colones = COALESCE(?, limite_diario_colones),
          alergias = COALESCE(?, alergias),
          bloquear_chucherias = COALESCE(?, bloquear_chucherias),
          permitir_transferencias = COALESCE(?, permitir_transferencias),
          bloqueo_qr_biometrico = COALESCE(?, bloqueo_qr_biometrico)
      WHERE id = ?
    `).run(limite_diario_colones, alergias, bloquear_chucherias, permitir_transferencias, bioVal, estId);

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
      broadcastEvent('seguridad_qr_actualizada', {
        id: estId,
        estudiante_id: estId,
        bloqueo_qr_biometrico: actualizado.bloqueo_qr_biometrico
      });
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
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : 1;
    const categorias = db.prepare('SELECT * FROM categorias ORDER BY orden ASC').all();
    
    const sql = `
      SELECT p.*, c.nombre as categoria_nombre, c.icono as categoria_icono
      FROM productos p
      JOIN categorias c ON p.categoria_id = c.id
      WHERE p.escuela_id = ?
      ORDER BY p.categoria_id, p.id ASC
    `;
    const productos = db.prepare(sql).all(escuelaId);

    res.json({ categorias, productos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear producto rápido en mostrador (en caliente)
app.post('/api/productos/rapido', (req, res) => {
  try {
    const { nombre, precio_colones, categoria_id, escuela_id } = req.body;
    const cleanNombre = (nombre || '').trim();
    const precio = parseInt(precio_colones, 10);
    const escuelaId = escuela_id ? parseInt(escuela_id, 10) : 1;

    if (!cleanNombre) {
      return res.status(400).json({ error: 'El nombre del producto es obligatorio' });
    }
    if (isNaN(precio) || precio <= 0) {
      return res.status(400).json({ error: 'El precio debe ser un monto válido mayor a ₡0' });
    }

    // Determinar categoría por defecto
    let targetCatId = categoria_id;
    if (!targetCatId) {
      const catSnack = db.prepare("SELECT id FROM categorias WHERE LOWER(nombre) LIKE '%snack%' OR LOWER(nombre) LIKE '%fruta%' OR LOWER(nombre) LIKE '%vario%' ORDER BY id ASC LIMIT 1").get();
      if (catSnack) {
        targetCatId = catSnack.id;
      } else {
        const catFirst = db.prepare("SELECT id FROM categorias ORDER BY id ASC LIMIT 1").get();
        targetCatId = catFirst ? catFirst.id : 1;
      }
    }

    const insertRes = db.prepare(`
      INSERT INTO productos (
        categoria_id, nombre, descripcion, precio_colones,
        imagen_url, icono, calorias, cumple_mep, alergenos,
        disponible, permite_preorden, destacado, control_stock, stock, escuela_id
      ) VALUES (?, ?, ?, ?, '', ?, 220, ?, 'Ninguno conocido', 1, 1, 0, 1, 10, ?)
    `).run(
      targetCatId,
      cleanNombre,
      'Producto rápido registrado en mostrador',
      precio,
      '🥪',
      1,
      escuelaId
    );

    const newId = insertRes.lastInsertRowid;
    const nuevoProducto = db.prepare(`
      SELECT p.*, c.nombre as categoria_nombre, c.icono as categoria_icono
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.id = ?
    `).get(newId);

    broadcastEvent('producto_actualizado', nuevoProducto);

    res.json({
      success: true,
      mensaje: `Producto "${cleanNombre}" agregado al inventario`,
      producto: nuevoProducto
    });
  } catch (error) {
    console.error('Error registrando producto rápido:', error);
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

    // Notificar actualización de productos si su stock o disponibilidad cambió
    if (resultado && Array.isArray(resultado.productosActualizados)) {
      for (const prodAct of resultado.productosActualizados) {
        broadcastEvent('producto_actualizado', prodAct);
      }
    }

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

// ==========================================
// RESILIENCIA OFFLINE: SINCRONIZACIÓN BATCH DE VENTAS OFFLINE DE LA SODA
// ==========================================
app.post('/api/ordenes/sincronizar-offline', (req, res) => {
  try {
    const { ordenes, escuela_id } = req.body;
    if (!Array.isArray(ordenes) || ordenes.length === 0) {
      return res.status(400).json({ error: 'No se enviaron órdenes para sincronizar' });
    }

    const resultados = [];
    const errores = [];

    for (const ord of ordenes) {
      try {
        const estId = ord.estudiante_id;
        if (!estId) {
          errores.push({ offline_id: ord.offline_id, error: 'Falta estudiante_id' });
          continue;
        }

        // Idempotencia: Verificar si esta orden offline ya fue procesada antes
        if (ord.offline_id) {
          const yaExiste = db.prepare(`
            SELECT id, codigo_orden FROM ordenes 
            WHERE notas LIKE ? OR codigo_orden = ?
          `).get(`%${ord.offline_id}%`, ord.offline_id);

          if (yaExiste) {
            resultados.push({
              offline_id: ord.offline_id,
              status: 'ya_procesada',
              codigo_orden: yaExiste.codigo_orden
            });
            continue;
          }
        }

        const itemsProc = (ord.items || []).map(i => ({
          producto_id: i.producto_id || (i.product && i.product.id),
          cantidad: i.cantidad || 1
        }));

        const resultado = crearOrdenCompleta({
          estudianteId: estId,
          tipoOrden: ord.tipo_orden || 'mostrador',
          momentoEntrega: ord.momento_entrega || 'inmediato',
          notas: `Venta offline sincronizada [Ref: ${ord.offline_id || 'LOCAL'}]`,
          items: itemsProc
        });

        // Notificar por SSE a la soda y pantallas
        broadcastEvent('nueva_orden', resultado);

        resultados.push({
          offline_id: ord.offline_id,
          status: 'creada',
          codigo_orden: resultado.codigo_orden,
          estudiante_id: estId,
          total: resultado.total_colones
        });
      } catch (errOrd) {
        console.error(`[Offline Sync] Error procesando orden ${ord.offline_id}:`, errOrd.message);
        errores.push({
          offline_id: ord.offline_id,
          error: errOrd.message
        });
      }
    }

    res.json({
      success: true,
      total_enviadas: ordenes.length,
      sincronizadas: resultados.length,
      fallidas: errores.length,
      resultados,
      errores
    });
  } catch (err) {
    res.status(500).json({ error: 'Error general en sincronización offline: ' + err.message });
  }
});

// Listar órdenes (con filtro por estado o tipo)
app.get('/api/ordenes', (req, res) => {
  try {
    const { estado, tipo, estudiante_id } = req.query;
    const escuelaId = req.query.escuela_id ? parseInt(req.query.escuela_id, 10) : null;
    let query = `
      SELECT o.*, e.nombre_completo as estudiante_nombre, e.grado, e.seccion, e.foto_url,
        (SELECT json_group_array(json_object('producto_id', d.producto_id, 'nombre', COALESCE(d.nombre_producto, p.nombre), 'icono', COALESCE(p.icono, '🥪'), 'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario, 'subtotal', d.subtotal))
         FROM orden_detalles d LEFT JOIN productos p ON d.producto_id = p.id WHERE d.orden_id = o.id) as items_json
      FROM ordenes o
      JOIN estudiantes e ON o.estudiante_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (escuelaId) {
      query += ' AND (o.escuela_id = ? OR e.escuela_id = ?)';
      params.push(escuelaId, escuelaId);
    }
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
      momento_entrega_label: formatMomentoLabel(o.momento_entrega, o.escuela_id || 1),
      items: Array.isArray(o.items_json)
        ? o.items_json
        : (typeof o.items_json === 'string' ? JSON.parse(o.items_json || '[]') : [])
    }));

    res.json(resultado);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar estado de una orden (Cocina -> Listo -> Entregado / Cancelado)
app.put('/api/ordenes/:id/estado', (req, res) => {
  try {
    const { estado, motivo, cajero_id, escuela_id } = req.body;
    const ordenId = req.params.id;

    const ord = db.prepare('SELECT * FROM ordenes WHERE id = ?').get(ordenId);
    if (!ord) return res.status(404).json({ error: 'Orden no encontrada' });

    const targetEscuelaId = escuela_id ? parseInt(escuela_id, 10) : null;
    if (targetEscuelaId && ord.escuela_id && ord.escuela_id !== targetEscuelaId) {
      return res.status(403).json({ error: 'No tienes permisos para modificar órdenes de otra escuela.' });
    }

    let actualizada;
    if (estado === 'entregado') {
      // Si es preorden y no ha sido debitada todavía
      const yaDebitada = db.prepare('SELECT COUNT(*) as count FROM transacciones_saldo WHERE orden_id = ?').get(ordenId).count > 0;
      if (ord.tipo_orden === 'preorden' && !yaDebitada) {
        const despacho = despacharPreordenTransaction({ ordenId, cajeroId: cajero_id || 6 });
        actualizada = despacho.orden;
        broadcastEvent('estudiante_actualizado', despacho.estudiante);
        broadcastEvent('saldo_actualizado', despacho.estudiante);
      } else {
        db.prepare("UPDATE ordenes SET estado = 'entregado', entregado_en = datetime('now', 'localtime') WHERE id = ?").run(ordenId);
        actualizada = db.prepare('SELECT * FROM ordenes WHERE id = ?').get(ordenId);
      }
    } else if (estado === 'cancelado') {
      cancelarPreorden(ordenId, motivo || 'Cancelada desde terminal');
      actualizada = db.prepare('SELECT * FROM ordenes WHERE id = ?').get(ordenId);
      const est = db.prepare('SELECT * FROM estudiantes WHERE id = ?').get(ord.estudiante_id);
      if (est) {
        const finEst = enriquecerEstudianteFinanzas(est);
        broadcastEvent('estudiante_actualizado', finEst);
        broadcastEvent('saldo_actualizado', finEst);
      }
      broadcastEvent('recargar_catalogo', {});
    } else {
      db.prepare(`
        UPDATE ordenes 
        SET estado = ?
        WHERE id = ?
      `).run(estado, ordenId);
      actualizada = db.prepare('SELECT * FROM ordenes WHERE id = ?').get(ordenId);
    }

    broadcastEvent('orden_actualizada', actualizada);
    res.json(actualizada);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Despacho ultra-rápido en fila de pre-órdenes mediante escaneo de QR (con débito contable oficial)
app.post('/api/ordenes/despachar-qr', (req, res) => {
  try {
    const { qr_token, cajero_id, escuela_id } = req.body;
    if (!qr_token) return res.status(400).json({ error: 'Se requiere el código QR del estudiante' });

    const est = db.prepare('SELECT * FROM estudiantes WHERE qr_token = ? OR codigo_estudiante = ?').get(qr_token, qr_token);
    if (!est) return res.status(404).json({ error: 'Estudiante no identificado' });

    const targetEscuelaId = escuela_id ? parseInt(escuela_id, 10) : null;
    if (targetEscuelaId && est.escuela_id && est.escuela_id !== targetEscuelaId) {
      return res.status(403).json({ error: '⛔ Este estudiante pertenece a otra institución escolar.' });
    }

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

    // Efectuar débito financiero formal y marcar entregada
    const despacho = despacharPreordenTransaction({ ordenId: preorden.id, cajeroId: cajero_id || 6 });

    // Obtener detalles para mostrar en pantalla de caja
    const items = db.prepare(`
      SELECT COALESCE(d.nombre_producto, p.nombre) as nombre, COALESCE(p.icono, '🥪') as icono, d.cantidad, d.subtotal
      FROM orden_detalles d
      LEFT JOIN productos p ON d.producto_id = p.id
      WHERE d.orden_id = ?
    `).all(preorden.id);

    const responseData = {
      exito: true,
      mensaje: `¡Pre-orden ${preorden.codigo_orden} cobrada y despachada con éxito!`,
      estudiante: despacho.estudiante,
      orden: {
        id: preorden.id,
        codigo: preorden.codigo_orden,
        momento_entrega: preorden.momento_entrega,
        momento_entrega_label: formatMomentoLabel(preorden.momento_entrega),
        total: preorden.total_colones,
        items
      }
    };

    broadcastEvent('orden_despachada', responseData);
    broadcastEvent('orden_actualizada', despacho.orden);
    broadcastEvent('estudiante_actualizado', despacho.estudiante);
    broadcastEvent('saldo_actualizado', despacho.estudiante);

    res.json(responseData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cierre de caja del día: expira y libera pre-órdenes no retiradas
app.post('/api/pos/cierre-caja', (req, res) => {
  try {
    const { escuela_id } = req.body;
    const resultado = expirarPreordenesVencidas({ motivo: 'cierre_caja', escuelaId: escuela_id || 1 });
    broadcastEvent('cierre_caja_realizado', resultado);
    broadcastEvent('recargar_catalogo', {});
    broadcastEvent('preordenes_actualizadas', {});
    res.json({
      exito: true,
      mensaje: `Cierre de caja completado con éxito. ${resultado.count} pre-orden(es) no retiradas fueron canceladas y su monto fue liberado al disponible de los estudiantes.`,
      ordenes_expiradas: resultado.count,
      monto_liberado_colones: resultado.liberadoColones
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verificador automático periódico de preórdenes vencidas (cada 60 segundos)
setInterval(() => {
  try {
    const exp = expirarPreordenesVencidas({ motivo: 'tiempo_limite' });
    if (exp && exp.count > 0) {
      console.log(`[AUTO-EXPIRACION] ${exp.count} pre-orden(es) vencidas canceladas. Liberado: ₡${exp.liberadoColones}`);
      broadcastEvent('preordenes_expiradas', exp);
      broadcastEvent('recargar_catalogo', {});
    }
  } catch (e) {
    console.warn('[AUTO-EXPIRACION] Error en verificación periódica:', e.message);
  }
}, 60 * 1000);

// Información de conectividad y túnel HTTPS
app.get('/api/server-info', (req, res) => {
  res.json({
    tunnelUrl: process.env.TUNNEL_URL || 'https://somewhat-ships-looksmart-optical.trycloudflare.com',
    httpsAvailable: true
  });
});

// Rutas amigables para landing page institucional
app.get(['/landing', '/inicio', '/presentacion'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/desktop-preview.html'));
});

// Rutas para Términos y Condiciones y Política de Privacidad (Google Play & Web)
app.get(['/legal', '/terminos', '/privacidad', '/terminos-y-condiciones', '/politica-de-privacidad'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/legal.html'));
});

// Ruta dedicada para Solicitud de Eliminación de Cuenta (Requisito Google Play Console y Apple)
app.get(['/eliminar-cuenta', '/borrar-cuenta', '/solicitar-eliminacion', '/delete-account'], (req, res) => {
  res.sendFile(path.join(__dirname, '../public/eliminar-cuenta.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor SiboPay iniciado en http://localhost:${PORT}`);
  console.log(`🌐 Presentación Institucional: http://localhost:${PORT}/desktop-preview.html`);
  console.log(`📱 PWA Estudiantes/Padres: http://localhost:${PORT}/index.html`);
  console.log(`📟 Terminal Soda/Escáner QR: http://localhost:${PORT}/pos.html`);
  console.log(`🖨️ Generador de Carnés Físicos: http://localhost:${PORT}/carnet.html`);
});
