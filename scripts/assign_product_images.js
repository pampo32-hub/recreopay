const { Client } = require('pg');

const pgUrl = process.env.DATABASE_URL || 'postgresql://sibopay_user:SiboPay_Postgres_2026_SecureKey!@127.0.0.1:5432/sibopay_db';

const MAPPING = [
  { match: /empanada.*arreglada/i, url: '/img/products/empanada_arreglada.jpg' },
  { match: /empanada.*queso/i, url: '/img/products/empanada_queso.jpg' },
  { match: /sandwich/i, url: '/img/products/sandwich_jamon_queso.jpg' },
  { match: /taco.*tico/i, url: '/img/products/taco_tico.jpg' },
  { match: /gallo.*pinto/i, url: '/img/products/gallo_pinto.jpg' },
  { match: /arroz.*pollo/i, url: '/img/products/arroz_con_pollo.jpg' },
  { match: /casad/i, url: '/img/products/casadito_infantil.jpg' },
  { match: /t[eé]\s*fr[ií]o/i, url: '/img/products/te_frio_limon.jpg' },
  { match: /mora/i, url: '/img/products/fresco_mora.jpg' },
  { match: /\bcas\b/i, url: '/img/products/fresco_cas.jpg' },
  { match: /leche.*chocolate/i, url: '/img/products/leche_chocolate.jpg' },
  { match: /fruta.*picada/i, url: '/img/products/fruta_picada.jpg' },
  { match: /yogurt/i, url: '/img/products/yogurt_granola.jpg' },
  { match: /barra.*avena/i, url: '/img/products/barra_avena.jpg' },
  { match: /gelatina/i, url: '/img/products/gelatina_tricolor.jpg' },
];

async function assignImages() {
  const client = new Client({ connectionString: pgUrl });
  await client.connect();
  console.log('🚀 Conectado a la base de datos PostgreSQL.');

  const res = await client.query('SELECT id, nombre FROM productos ORDER BY id ASC;');
  console.log(`Encontrados ${res.rows.length} productos en la base de datos.`);

  for (const prod of res.rows) {
    let chosenUrl = null;
    for (const rule of MAPPING) {
      if (rule.match.test(prod.nombre)) {
        chosenUrl = rule.url;
        break;
      }
    }

    if (chosenUrl) {
      await client.query('UPDATE productos SET imagen_url = $1 WHERE id = $2;', [chosenUrl, prod.id]);
      console.log(`✅ [ID ${prod.id}] "${prod.nombre}" -> ${chosenUrl}`);
    } else {
      console.warn(`⚠️ [ID ${prod.id}] "${prod.nombre}" no tuvo coincidencia de imagen.`);
    }
  }

  await client.end();
  console.log('✨ Asignación de imágenes completada y verificada.');
}

assignImages().catch(console.error);
