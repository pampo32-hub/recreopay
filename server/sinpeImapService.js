/**
 * Servicio de Lectura y Conciliación IMAP de Notificaciones SINPE Móvil para SiboPay
 */

const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const { parseSinpeEmail, normalizarCodigoDetalle } = require('./sinpeParser');

let isChecking = false;

const getImapConfig = () => {
  const cleanPassword = (process.env.SINPE_EMAIL_PASSWORD || '').replace(/\s+/g, '');
  return {
    imap: {
      user: process.env.SINPE_EMAIL_USER || '',
      password: cleanPassword,
      host: process.env.SINPE_IMAP_HOST || 'imap.gmail.com',
      port: parseInt(process.env.SINPE_IMAP_PORT || '993', 10),
      tls: true,
      authTimeout: 10000,
      tlsOptions: { rejectUnauthorized: false }
    }
  };
};

/**
 * Escanea la bandeja de entrada buscando los correos más recientes de notificación SINPE
 * y los guarda en la base de datos de transacciones.
 */
async function checkSinpeEmailsOnce(db) {
  if (isChecking) return { scanned: 0, status: 'already_running' };

  const user = process.env.SINPE_EMAIL_USER;
  const pass = process.env.SINPE_EMAIL_PASSWORD;
  const isEnabled = process.env.SINPE_IMAP_ENABLED === 'true' || process.env.SINPE_IMAP_ENABLED === '1';

  if (!isEnabled || !user || !pass) {
    return { scanned: 0, status: 'disabled_or_unconfigured' };
  }

  isChecking = true;
  let connection = null;
  let savedCount = 0;

  try {
    const config = getImapConfig();
    connection = await imapSimple.connect(config);
    const box = await connection.openBox('INBOX');

    const totalMessages = (box && box.messages && box.messages.total) || 0;
    if (totalMessages === 0) {
      return { scanned: 0, status: 'empty_inbox' };
    }

    // Consultar los últimos 25 correos
    const startSeq = Math.max(1, totalMessages - 24);
    const searchCriteria = [`${startSeq}:${totalMessages}`];
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false,
      struct: true
    };

    const messages = await connection.search(searchCriteria, fetchOptions);

    if (messages && messages.length > 0) {
      for (const msg of messages) {
        try {
          const headerPart = msg.parts.find(p => p.which === 'HEADER');
          const rawHeader = headerPart ? headerPart.body : {};
          let subject = Array.isArray(rawHeader.subject) ? rawHeader.subject[0] : (rawHeader.subject || '');
          let from = Array.isArray(rawHeader.from) ? rawHeader.from[0] : (rawHeader.from || '');

          const allPart = msg.parts.find(p => p.which === '' || p.which === 'TEXT');
          let bodyText = '';
          let bodyHtml = '';

          if (allPart && allPart.body) {
            const parsed = await simpleParser(allPart.body);
            bodyText = parsed.text || '';
            bodyHtml = parsed.html || '';
            if (parsed.subject) subject = parsed.subject;
            if (parsed.from && parsed.from.text) from = parsed.from.text;
          }

          const parsedSinpe = parseSinpeEmail(subject, bodyText, bodyHtml, from);

          if (parsedSinpe.isSinpe && parsedSinpe.amountCrc > 0) {
            const txId = `sinpe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const normCod = parsedSinpe.codigoDetalleNormalizado || '';
            const refNum = parsedSinpe.referenceNumber || (normCod ? `REF-${normCod}` : `TX-${Date.now()}`);

            // Insertar o ignorar si ya existe
            try {
              if (db) {
                const existing = db.prepare(`
                  SELECT id FROM sinpe_transacciones_banco 
                  WHERE (codigo_detalle_norm = ? AND codigo_detalle_norm IS NOT NULL AND codigo_detalle_norm != '')
                     OR (reference_number = ? AND reference_number IS NOT NULL AND reference_number != '')
                  LIMIT 1
                `).get(normCod || '__none__', refNum);

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
                    JSON.stringify({ from, subject, summary: parsedSinpe.rawSummary })
                  );
                  savedCount++;
                  console.log(`💵 [SINPE IMAP] Notificación registrada: ₡${parsedSinpe.amountCrc} | Código: ${parsedSinpe.codigoDetalle || 'N/A'} | Ref: #${refNum} | Banco: ${parsedSinpe.originBank}`);
                }
              }
            } catch (dbErr) {
              console.warn('⚠️ [SINPE IMAP] Error al persistir en BD:', dbErr.message);
            }
          }
        } catch (msgErr) {
          console.warn('⚠️ [SINPE IMAP] Error procesando correo:', msgErr.message);
        }
      }
    }

    return { scanned: messages ? messages.length : 0, saved: savedCount, status: 'ok' };
  } catch (err) {
    console.error('❌ [SINPE IMAP] Error de conexión:', err.message);
    return { scanned: 0, status: 'error', error: err.message };
  } finally {
    if (connection) {
      try { connection.end(); } catch (_) {}
    }
    isChecking = false;
  }
}

/**
 * Inserta manualmente una transacción simulada (útil para pruebas inmediatas en QA o sin transferir dinero real)
 */
function simularSinpeEmail(db, { codigo, codigoDetalle, monto, banco, remitente, telefono, comprobante }) {
  if (!db) throw new Error('DB no inicializada');
  const txId = `sim_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const rawCod = codigo || codigoDetalle || null;
  const cleanCod = rawCod ? String(rawCod).trim() : null;
  const normCod = cleanCod ? normalizarCodigoDetalle(cleanCod) : null;
  const refNum = comprobante ? String(comprobante).trim() : (normCod ? `REF-${normCod}` : `SIM-${Date.now()}`);
  const montoNum = parseInt(monto, 10) || 1000;

  db.prepare(`
    INSERT INTO sinpe_transacciones_banco 
      (id, reference_number, codigo_detalle, codigo_detalle_norm, amount_crc, sender_phone, sender_name, origin_bank, status, raw_data)
    VALUES 
      (?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', ?)
  `).run(
    txId,
    refNum,
    cleanCod,
    normCod,
    montoNum,
    telefono || '8888-1122',
    remitente || 'Padre de Familia',
    banco || 'BAC Credomatic',
    JSON.stringify({ simulado: true, fecha: new Date().toISOString() })
  );

  return {
    id: txId,
    codigo_detalle: cleanCod,
    codigo_detalle_norm: normCod,
    reference_number: refNum,
    amount_crc: montoNum,
    origin_bank: banco || 'BAC Credomatic',
    sender_name: remitente || 'Padre de Familia'
  };
}

module.exports = {
  checkSinpeEmailsOnce,
  simularSinpeEmail
};
