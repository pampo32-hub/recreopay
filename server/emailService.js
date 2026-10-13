const nodemailer = require('nodemailer');

/**
 * Servicio de envío de correos electrónicos transaccionales para SiboPay
 */

function getTransporter() {
  const user = process.env.SMTP_USER || process.env.SINPE_EMAIL_USER || 'pampo32@gmail.com';
  const rawPass = process.env.SMTP_PASSWORD || process.env.SINPE_EMAIL_PASSWORD || 'aeguiflzmskmaswq';
  const pass = String(rawPass).replace(/\s+/g, '');

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: (process.env.SMTP_PORT || '465') === '465', // true para 465, false para 587
    auth: {
      user: user,
      pass: pass
    }
  });
}

/**
 * Envía el código numérico de 6 dígitos para restablecer contraseña
 */
async function enviarCodigoRecuperacion(destinatario, codigo, nombreUsuario = 'Usuario') {
  const transporter = getTransporter();
  const remitente = process.env.SMTP_FROM || `SiboPay Soporte <${process.env.SMTP_USER || 'pampo32@gmail.com'}>`;

  const mailOptions = {
    from: remitente,
    to: destinatario,
    subject: `🔐 SiboPay - Código para restablecer contraseña: ${codigo}`,
    text: `Hola ${nombreUsuario},\n\nTu código de verificación para restablecer tu contraseña en SiboPay es: ${codigo}\n\nEste código es válido durante 15 minutos. Si no solicitaste este cambio, puedes ignorar este mensaje.\n\nAtentamente,\nEquipo SiboPay`,
    html: `
      <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 30px 15px; color: #1e293b;">
        <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
          
          <div style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 26px 20px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">SiboPay</h1>
            <p style="margin: 6px 0 0; font-size: 13px; opacity: 0.9;">Recuperación Segura de Cuenta</p>
          </div>

          <div style="padding: 28px 24px; text-align: center;">
            <h2 style="font-size: 18px; color: #0f172a; margin-top: 0; margin-bottom: 12px; font-weight: 700;">Restablecer tu Contraseña</h2>
            <p style="font-size: 14px; color: #64748b; line-height: 1.5; margin: 0 0 24px;">
              Hola <strong>${nombreUsuario}</strong>, recibimos una solicitud para restablecer la contraseña de tu cuenta. Ingresa el siguiente código de verificación en la aplicación:
            </p>

            <div style="background: #f0f9ff; border: 2px dashed #0284c7; border-radius: 12px; padding: 18px 10px; margin-bottom: 24px; display: inline-block; min-width: 200px;">
              <span style="font-family: monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0369a1;">${codigo}</span>
            </div>

            <p style="font-size: 12px; color: #94a3b8; line-height: 1.4; margin: 0;">
              ⏳ Este código vencerá en <strong>15 minutos</strong>.<br>
              Si no solicitaste este cambio, haz caso omiso a este correo.
            </p>
          </div>

          <div style="background: #f1f5f9; padding: 14px 20px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0; font-size: 11px; color: #64748b;">
              &copy; SiboPay - Sistema Inteligente de Billetera Online. Todos los derechos reservados.
            </p>
          </div>
        </div>
      </div>
    `
  };

  return transporter.sendMail(mailOptions);
}

module.exports = {
  enviarCodigoRecuperacion
};
