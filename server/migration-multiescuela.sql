-- MIGRACIÓN MULTI-ESCUELA (RECREOPAY / PAYAPP)
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

INSERT INTO escuelas (id, codigo, nombre, telefono_sinpe, nombre_sinpe, concesionario, activo) 
VALUES (1, 'ESC01', 'Soda Escolar Central', '8888-8888', 'Soda Central', 'Concesionario Central', true) 
ON CONFLICT (id) DO NOTHING;

SELECT setval('escuelas_id_seq', (SELECT GREATEST(MAX(id), 1) FROM escuelas));

ALTER TABLE estudiantes ADD COLUMN IF NOT EXISTS escuela_id INTEGER DEFAULT 1 REFERENCES escuelas(id);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS escuela_id INTEGER DEFAULT 1 REFERENCES escuelas(id);
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS escuela_id INTEGER DEFAULT 1 REFERENCES escuelas(id);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS escuela_id INTEGER DEFAULT 1 REFERENCES escuelas(id);
ALTER TABLE solicitudes_recarga_sinpe ADD COLUMN IF NOT EXISTS escuela_id INTEGER DEFAULT 1 REFERENCES escuelas(id);

UPDATE estudiantes SET escuela_id = 1 WHERE escuela_id IS NULL;
UPDATE productos SET escuela_id = 1 WHERE escuela_id IS NULL;
UPDATE ordenes SET escuela_id = 1 WHERE escuela_id IS NULL;
UPDATE usuarios SET escuela_id = 1 WHERE escuela_id IS NULL;
UPDATE solicitudes_recarga_sinpe SET escuela_id = 1 WHERE escuela_id IS NULL;
