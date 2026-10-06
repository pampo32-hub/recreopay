const { Client } = require('pg');

const pgUrl = process.env.DATABASE_URL || 'postgresql://postgres:GammaPos2026@127.0.0.1:5432/recreopay_db';

const NEW_PRODUCTS = [
  // --- 10 COMIDAS Y SNACKS ---
  {
    categoria_id: 1, // Meriendas Saludables
    nombre: 'Chalupa de Pollo Mechado',
    descripcion: 'Tortilla de maíz tostada con frijoles molidos, pollo mechado, repollo fresco y salsa rosada.',
    precio_colones: 1400,
    imagen_url: '/img/products/chalupa_pollo.jpg',
    icono: 'utensils',
    alergenos: 'Ninguno'
  },
  {
    categoria_id: 1, // Meriendas Saludables
    nombre: 'Quesadilla de Queso y Frijol',
    descripcion: 'Tortilla de trigo dorada a la plancha con abundante queso blanco fundido y frijoles negros.',
    precio_colones: 1100,
    imagen_url: '/img/products/quesadilla_queso_frijol.jpg',
    icono: 'sandwich',
    alergenos: 'Lácteos, Gluten'
  },
  {
    categoria_id: 2, // Platos Fuertes y Pintos
    nombre: 'Pinto con Huevo y Salchicha',
    descripcion: 'Gallo pinto tradicional con huevo revuelto fresco y salchicha criolla en rodajas.',
    precio_colones: 1500,
    imagen_url: '/img/products/pinto_huevo_salchicha.jpg',
    icono: 'utensils',
    alergenos: 'Huevo'
  },
  {
    categoria_id: 2, // Platos Fuertes y Pintos
    nombre: 'Casado con Pechuga a la Plancha',
    descripcion: 'Pechuga a la plancha con arroz blanco, frijoles negros, plátano maduro y ensalada fresca.',
    precio_colones: 2200,
    imagen_url: '/img/products/casado_pollo_plancha.jpg',
    icono: 'utensils',
    alergenos: 'Ninguno'
  },
  {
    categoria_id: 1, // Meriendas Saludables
    nombre: 'Pastelito de Pollo Hojaldrado',
    descripcion: 'Pastel horneado de hojaldre crujiente relleno de pechuga de pollo desmenuzada y verduras.',
    precio_colones: 950,
    imagen_url: '/img/products/pastel_pollo_hojaldre.jpg',
    icono: 'croissant',
    alergenos: 'Gluten'
  },
  {
    categoria_id: 1, // Meriendas Saludables
    nombre: 'Pan con Aguacate y Huevo Duro',
    descripcion: 'Pan tostado integral con aguacate majado, huevo duro en rodajas y toque de sal.',
    precio_colones: 1200,
    imagen_url: '/img/products/pan_aguacate_huevo.jpg',
    icono: 'sandwich',
    alergenos: 'Huevo, Gluten'
  },
  {
    categoria_id: 4, // Frutas y Snacks
    nombre: 'Dedos de Queso Horneados',
    descripcion: 'Palitos suaves horneados rellenos de queso blanco tierno, servidos con salsa de tomate.',
    precio_colones: 1000,
    imagen_url: '/img/products/dedos_queso_horneados.jpg',
    icono: 'cookie',
    alergenos: 'Lácteos, Gluten'
  },
  {
    categoria_id: 4, // Frutas y Snacks
    nombre: 'Muffin Casero de Zanahoria',
    descripcion: 'Muffin esponjoso horneado con zanahoria fresca rallada, canela y pasas.',
    precio_colones: 750,
    imagen_url: '/img/products/muffin_zanahoria.jpg',
    icono: 'cookie',
    alergenos: 'Huevo, Gluten'
  },
  {
    categoria_id: 4, // Frutas y Snacks
    nombre: 'Bowl de Avena con Manzana y Canela',
    descripcion: 'Avena tibia en leche descremada con trozos de manzana fresca y canela molida.',
    precio_colones: 850,
    imagen_url: '/img/products/bowl_avena_manzana.jpg',
    icono: 'bowl',
    alergenos: 'Lácteos'
  },
  {
    categoria_id: 1, // Meriendas Saludables
    nombre: 'Tacos Dorados de Papa y Queso',
    descripcion: 'Tacos crujientes de maíz rellenos de puré de papa sazonado y queso fresco.',
    precio_colones: 1150,
    imagen_url: '/img/products/tacos_papa_queso.jpg',
    icono: 'pizza',
    alergenos: 'Lácteos'
  },

  // --- 5 REFRESCOS NATURALES (Categoría 3) ---
  {
    categoria_id: 3, // Bebidas y Frescos
    nombre: 'Fresco Natural de Maracuyá (350ml)',
    descripcion: 'Jugo natural de maracuyá costarricense preparado con hielo y semillas frescas.',
    precio_colones: 750,
    imagen_url: '/img/products/fresco_maracuya.jpg',
    icono: 'cup-soda',
    alergenos: 'Ninguno'
  },
  {
    categoria_id: 3, // Bebidas y Frescos
    nombre: 'Fresco Natural de Sandía (350ml)',
    descripcion: 'Bebida natural de sandía fresca licuada con hielo, dulce, ligera y refrescante.',
    precio_colones: 700,
    imagen_url: '/img/products/fresco_sandia.jpg',
    icono: 'cup-soda',
    alergenos: 'Ninguno'
  },
  {
    categoria_id: 3, // Bebidas y Frescos
    nombre: 'Limonada con Hierbabuena (350ml)',
    descripcion: 'Limonada natural recién exprimida con hojas frescas de hierbabuena y hielo picado.',
    precio_colones: 750,
    imagen_url: '/img/products/limonada_hierbabuena.jpg',
    icono: 'cup-soda',
    alergenos: 'Ninguno'
  },
  {
    categoria_id: 3, // Bebidas y Frescos
    nombre: 'Batido Natural de Guanábana (350ml)',
    descripcion: 'Fresco cremoso de pulpa natural de guanábana con hielo, suave y tropical.',
    precio_colones: 850,
    imagen_url: '/img/products/fresco_guanabana.jpg',
    icono: 'cup-soda',
    alergenos: 'Ninguno'
  },
  {
    categoria_id: 3, // Bebidas y Frescos
    nombre: 'Fresco de Piña con Arroz (350ml)',
    descripcion: 'Tradicional refresco tico de piña cocida con arroz y toque de canela, servido bien frío.',
    precio_colones: 750,
    imagen_url: '/img/products/fresco_pina_arroz.jpg',
    icono: 'cup-soda',
    alergenos: 'Ninguno'
  }
];

async function seed() {
  const client = new Client({ connectionString: pgUrl });
  await client.connect();
  console.log('🚀 Conectado a PostgreSQL.');

  // Obtener escuelas activas
  const escuelasRes = await client.query('SELECT id, nombre FROM escuelas ORDER BY id ASC;');
  const escuelas = escuelasRes.rows;
  console.log(`Escuelas encontradas: ${escuelas.map(e => `${e.id}: ${e.nombre}`).join(', ')}`);

  for (const esc of escuelas) {
    console.log(`\n📌 Procesando productos para Escuela ID ${esc.id} (${esc.nombre})...`);
    for (const item of NEW_PRODUCTS) {
      // Verificar si ya existe en esta escuela
      const checkRes = await client.query(
        'SELECT id FROM productos WHERE escuela_id = $1 AND LOWER(TRIM(nombre)) = LOWER(TRIM($2));',
        [esc.id, item.nombre]
      );

      if (checkRes.rows.length === 0) {
        const insertRes = await client.query(
          `INSERT INTO productos 
           (categoria_id, nombre, descripcion, precio_colones, imagen_url, icono, alergenos, stock, es_saludable, cumple_mep, disponible, permite_preorden, control_stock, escuela_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 25, 1, 1, 1, 1, 1, $8)
           RETURNING id;`,
          [
            item.categoria_id,
            item.nombre,
            item.descripcion,
            item.precio_colones,
            item.imagen_url,
            item.icono,
            item.alergenos,
            esc.id
          ]
        );
        console.log(`  ➕ Insertado: [ID ${insertRes.rows[0].id}] ${item.nombre} (₡${item.precio_colones})`);
      } else {
        // Actualizar foto y datos
        await client.query(
          `UPDATE productos 
           SET descripcion = $1, precio_colones = $2, imagen_url = $3, icono = $4, alergenos = $5, categoria_id = $6
           WHERE id = $7;`,
          [
            item.descripcion,
            item.precio_colones,
            item.imagen_url,
            item.icono,
            item.alergenos,
            item.categoria_id,
            checkRes.rows[0].id
          ]
        );
        console.log(`  🔄 Actualizado: [ID ${checkRes.rows[0].id}] ${item.nombre}`);
      }
    }
  }

  // Comprobar total de productos en Escuela 1
  const countRes = await client.query('SELECT COUNT(*) as total FROM productos WHERE escuela_id = 1;');
  console.log(`\n✨ Total de productos en Escuela 1: ${countRes.rows[0].total}`);

  await client.end();
}

seed().catch(console.error);
