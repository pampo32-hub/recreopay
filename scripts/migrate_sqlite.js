const db = require('../server/db');

try {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS escuelas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      telefono_sinpe TEXT DEFAULT '8888-8888',
      nombre_sinpe TEXT DEFAULT 'Soda Central',
      concesionario TEXT,
      activo INTEGER DEFAULT 1,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO escuelas (id, codigo, nombre, telefono_sinpe, nombre_sinpe, concesionario, activo) 
    VALUES (1, 'ESC01', 'Soda Escolar Central', '8888-8888', 'Soda Central', 'Concesionario Central', 1);
  `);
  
  // Column additions if missing
  const cols = [
    { table: 'estudiantes', col: 'escuela_id', type: 'INTEGER DEFAULT 1' },
    { table: 'productos', col: 'escuela_id', type: 'INTEGER DEFAULT 1' },
    { table: 'ordenes', col: 'escuela_id', type: 'INTEGER DEFAULT 1' },
    { table: 'usuarios', col: 'escuela_id', type: 'INTEGER DEFAULT 1' },
    { table: 'solicitudes_recarga_sinpe', col: 'escuela_id', type: 'INTEGER DEFAULT 1' }
  ];

  for (const c of cols) {
    try {
      db.db.exec(`ALTER TABLE ${c.table} ADD COLUMN ${c.col} ${c.type};`);
    } catch (e) {
      // Column might already exist
    }
  }

  console.log('SQLite local database migration completed successfully!');
} catch (err) {
  console.error('Migration error:', err);
}
