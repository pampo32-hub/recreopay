const { db } = require('../server/db.js');

try {
  const row = db.prepare(`
    SELECT column_name, data_type, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'estudiantes' AND column_name = 'bloqueo_qr_biometrico'
  `).get();
  console.log('PG_COLUMN_INFO:', JSON.stringify(row));

  const sample = db.prepare(`
    SELECT id, codigo_estudiante, nombre_completo, bloqueo_qr_biometrico 
    FROM estudiantes 
    LIMIT 3
  `).all();
  console.log('PG_STUDENTS_SAMPLE:', JSON.stringify(sample));
} catch (err) {
  console.error('ERROR_CHECKING_PG:', err.message);
}
