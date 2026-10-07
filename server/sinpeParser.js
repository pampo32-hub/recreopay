/**
 * Parser de Notificaciones Bancarias de SINPE Móvil (Costa Rica) para SiboPay
 * Extrae:
 * - Códigos de detalle SiboPay (SIBO-XXXX o SIBOXXXX) con tolerancia total a guiones/espacios/mayúsculas
 * - Montos en colones (₡ / CRC)
 * - Números de comprobante / referencia bancaria
 * - Banco de origen (BAC, BCR, BNCR, Promerica, Davivienda, Scotiabank, etc.)
 * - Teléfono y nombre del remitente
 */

function stripHtml(html = '') {
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza un código de SINPE para comparación tolerante
 * Ejemplos: "SIBO-7K9M", "sibo7k9m", "SIBO 7k9m", "sibo-7k9m" -> "SIBO7K9M"
 */
function normalizarCodigoDetalle(codigo = '') {
  if (!codigo) return '';
  const str = String(codigo).trim();
  const match = str.match(/\bSIBO[\s\-_]?([A-Za-z0-9]{3,8})\b/i) || str.match(/SIBO[\s\-_]?([A-Za-z0-9]{3,8})/i);
  if (match) {
    return `SIBO${match[1].toUpperCase()}`;
  }
  return str.replace(/[\s\-_]/g, '').toUpperCase();
}

function parseSinpeEmail(arg1 = '', bodyText = '', bodyHtml = '', from = '') {
  let subject = '';
  let text = '';
  let html = '';
  let cleanFrom = '';

  if (typeof arg1 === 'object' && arg1 !== null) {
    subject = arg1.subject || '';
    text = arg1.text || arg1.bodyText || '';
    html = arg1.html || arg1.bodyHtml || '';
    cleanFrom = String(arg1.from || '').toLowerCase();
  } else {
    subject = String(arg1 || '');
    text = String(bodyText || '');
    html = String(bodyHtml || '');
    cleanFrom = String(from || '').toLowerCase();
  }

  const fullText = `${subject}\n${text}\n${stripHtml(html)}`.trim();
  const lowerText = fullText.toLowerCase();

  // 1. Detección de Banco de Costa Rica
  let originBank = 'SINPE Móvil CR';
  if (cleanFrom.includes('bac') || lowerText.includes('bac credomatic') || lowerText.includes('bac san jose')) {
    originBank = 'BAC Credomatic';
  } else if (cleanFrom.includes('bncr') || lowerText.includes('banco nacional') || lowerText.includes('bn móvil') || lowerText.includes('bn movil')) {
    originBank = 'Banco Nacional (BNCR)';
  } else if (cleanFrom.includes('bancobcr') || cleanFrom.includes('bcr') || lowerText.includes('banco de costa rica')) {
    originBank = 'Banco de Costa Rica (BCR)';
  } else if (cleanFrom.includes('promerica') || lowerText.includes('promerica')) {
    originBank = 'Banco Promerica';
  } else if (cleanFrom.includes('scotiabank') || lowerText.includes('scotiabank')) {
    originBank = 'Scotiabank';
  } else if (cleanFrom.includes('davivienda') || lowerText.includes('davivienda')) {
    originBank = 'Davivienda';
  } else if (cleanFrom.includes('wink') || cleanFrom.includes('coopenae') || lowerText.includes('wink')) {
    originBank = 'Wink (Coopenae)';
  } else if (cleanFrom.includes('sibopay') || cleanFrom.includes('simulad')) {
    originBank = 'SiboPay Direct';
  }

  // 2. Extraer Código de Detalle SiboPay (Tolerancia total a guión, espacios o todo pegado)
  let codigoDetalle = null;
  const codigoRegex = /\bSIBO[\s\-_]?([A-Za-z0-9]{3,8})\b/i;
  const matchCodigo = fullText.match(codigoRegex) || fullText.match(/SIBO[\s\-_]?([A-Za-z0-9]{3,8})/i);
  if (matchCodigo) {
    codigoDetalle = `SIBO-${matchCodigo[1].toUpperCase()}`;
  }

  // 3. Extraer Monto en Colones (₡ / CRC / ¢)
  let amountCrc = 0;
  const amountPatterns = [
    /(?:monto|importe|valor|suma|por concepto de|total|cr[eé]dito|acreditad[oa]|recibid[oa]|transferid[oa])\s*(?:de|por)?\s*[:#=\-]?\s*(?:₡|¢|CRC)?\s*([0-9]+(?:[,.\s][0-9]+)*)\s*(?:colones|crc|¢|₡)?/i,
    /(?:₡|¢|CRC)\s*[:#=\-]?\s*([0-9]+(?:[,.\s][0-9]+)*)/i,
    /([0-9]+(?:[,.\s][0-9]+)*)\s*(?:colones|crc|¢|₡)/i,
    /(?:crc|colones)\s*[:#=\-]?\s*([0-9]+(?:[,.\s][0-9]+)*)/i
  ];

  for (const regex of amountPatterns) {
    const match = fullText.match(regex);
    if (match && match[1]) {
      let numStr = match[1].trim().replace(/\s+/g, '');
      if (numStr.includes('.') && numStr.includes(',')) {
        if (numStr.indexOf('.') < numStr.indexOf(',')) {
          numStr = numStr.replace(/\./g, '').replace(',', '.');
        } else {
          numStr = numStr.replace(/,/g, '');
        }
      } else if (numStr.includes(',')) {
        const parts = numStr.split(',');
        if (parts[1] && parts[1].length === 2) {
          numStr = parts[0] + '.' + parts[1];
        } else {
          numStr = numStr.replace(/,/g, '');
        }
      }
      const parsedNum = parseFloat(numStr);
      if (!isNaN(parsedNum) && parsedNum > 0) {
        amountCrc = Math.round(parsedNum);
        break;
      }
    }
  }

  // 4. Extraer Teléfono Emisor (8 dígitos)
  let senderPhone = null;
  const phonePatterns = [
    /(?:tel[eé]fono|origen|celular|m[oó]vil|remitente|emisor)\s*[:#=\-]?\s*(?:\+?506\s*[-.]?)?([245678]\d{3}[-\s.]?\d{4})/i,
    /(?:\+?506\s*[-.]?)?([245678]\d{3}[-\s.]?\d{4})/i
  ];
  for (const regex of phonePatterns) {
    const match = fullText.match(regex);
    if (match && match[1]) {
      const digits = match[1].replace(/\D/g, '');
      if (digits.length === 8) {
        senderPhone = `${digits.slice(0, 4)}-${digits.slice(4)}`;
        break;
      }
    }
  }

  // 5. Extraer Número de Comprobante / Referencia Bancaria
  let referenceNumber = null;
  const refPatterns = [
    /(?:n[uú]mero\s*(?:de\s*)?|n[o°º]\.?\s*(?:de\s*)?|c[oó]digo\s*(?:de\s*)?)?(?:comprobante|referencia|transacci[oó]n|autorizaci[oó]n|operaci[oó]n|documento|folio|confirmaci[oó]n|trf|ref|doc|aut)(?:\s+de\s+(?:transferencia|pago|operaci[oó]n|dep[oó]sito|transacci[oó]n))?\s*[:#=\.\-]?\s*([A-Za-z0-9\-_]{4,35})/i,
    /#\s*([A-Za-z0-9\-_]{4,24})/,
    /(?:SINPE|TRF|DOC|REF|AUT)[-_]?([0-9]{4,20})/i
  ];
  for (const regex of refPatterns) {
    const match = fullText.match(regex);
    if (match && match[1]) {
      const clean = match[1].trim();
      if (!clean.toUpperCase().startsWith('SIBO') && clean.length >= 4) {
        referenceNumber = clean;
        break;
      }
    }
  }

  // 6. Nombre del remitente si está disponible
  let senderName = null;
  const nameMatch = fullText.match(/(?:de|de parte de|remitente|ordenante|cliente|titular)\s*[:#=\-]?\s*([A-Za-zÀ-ÿ\s]{4,40})(?:\n|\r|\.|,|-)/i);
  if (nameMatch && nameMatch[1]) {
    const cand = nameMatch[1].trim();
    if (!cand.toLowerCase().includes('banco') && !cand.toLowerCase().includes('sinpe')) {
      senderName = cand;
    }
  }

  return {
    isSinpe: Boolean(amountCrc > 0 && (codigoDetalle || referenceNumber || originBank !== 'SINPE Móvil CR')),
    codigoDetalle,
    codigoDetalleNormalizado: codigoDetalle ? normalizarCodigoDetalle(codigoDetalle) : null,
    amount: amountCrc,
    amountCrc,
    referenceNumber: referenceNumber || (codigoDetalle ? `REF-${codigoDetalle.replace(/[^A-Za-z0-9]/g, '')}` : null),
    senderPhone: senderPhone || '',
    senderName: senderName || 'Cliente SINPE',
    originBank,
    rawSummary: subject || ''
  };
}

module.exports = {
  parseSinpeEmail,
  normalizarCodigoDetalle
};
