const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP_URL = 'http://localhost:3030/app';
const POS_URL = 'http://localhost:3030/pos.html';

const BASE_OUT_DIR = path.join(__dirname, '../screenshots');

// Especificaciones oficiales exigidas por Apple App Store Connect y Google Play Console
const PRESETS = [
  {
    name: 'apple_app_store/iphone_6_7_inch',
    description: 'iPhone 6.7" (iPhone 16 / 15 / 14 Pro Max) - 1290 x 2796 px',
    width: 430,
    height: 932,
    scale: 3,
    expectedRes: '1290 x 2796'
  },
  {
    name: 'apple_app_store/iphone_6_5_inch',
    description: 'iPhone 6.5" (iPhone 11 Pro Max / XS Max / XR) - 1242 x 2688 px',
    width: 414,
    height: 896,
    scale: 3,
    expectedRes: '1242 x 2688'
  },
  {
    name: 'google_play_store/phone_1080x2400',
    description: 'Android Phone Google Play (FHD+ 20:9) - 1080 x 2400 px',
    width: 360,
    height: 800,
    scale: 3,
    expectedRes: '1080 x 2400'
  },
  {
    name: 'apple_app_store/ipad_pro_12_9_inch',
    description: 'iPad Pro 12.9" (App Store Tablet) - 2048 x 2732 px',
    width: 1024,
    height: 1366,
    scale: 2,
    expectedRes: '2048 x 2732'
  }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Sanitización y anonimización de nombres reales para screenshots oficiales de tiendas
async function anonymizeNamesInPage(page) {
  await page.evaluate(() => {
    const walkTextNodes = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue) continue;
        let txt = node.nodeValue;
        txt = txt.replace(/Mateo Alvarado Castro/gi, 'Nombre del Estudiante');
        txt = txt.replace(/Mateo Castro Alvarado/gi, 'Nombre del Estudiante');
        txt = txt.replace(/Carlos Alvarado \(Papá\)/gi, 'Nombre de los Padres');
        txt = txt.replace(/Carlos Alvarado/gi, 'Nombre del Padre');
        txt = txt.replace(/QR-MATEO-/gi, 'QR-ESTUDIANTE-');
        if (txt !== node.nodeValue) {
          node.nodeValue = txt;
        }
      }
    };

    // 1. Reemplazos globales en todos los nodos de texto
    walkTextNodes(document.body);

    // 2. Tarjeta del Estudiante en Menú Principal
    const walletName = document.getElementById('walletName');
    if (walletName) walletName.textContent = 'Nombre del Estudiante';

    const walletAvatar = document.getElementById('walletAvatar');
    if (walletAvatar) walletAvatar.textContent = 'NE';

    // 3. Modal de Carné QR
    const qrCardTitle = document.querySelector('.qr-card-header-title');
    if (qrCardTitle) {
      let sub = document.getElementById('qrStudentNameHeader');
      if (!sub) {
        sub = document.createElement('div');
        sub.id = 'qrStudentNameHeader';
        sub.style.cssText = 'font-size: 0.95rem; font-weight: 800; color: #0284c7; margin-top: 4px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;';
        qrCardTitle.parentNode.insertBefore(sub, qrCardTitle.nextSibling);
      }
      sub.textContent = 'Nombre del Estudiante';
    }

    const qrToken = document.getElementById('qrTokenDisplay');
    if (qrToken) {
      qrToken.textContent = qrToken.textContent.replace(/MATEO/g, 'ESTUDIANTE');
    }

    // 4. Portal de Padres: Cabecera
    const parentLoggedName = document.getElementById('parentLoggedName');
    if (parentLoggedName) {
      parentLoggedName.textContent = 'Nombre de los Padres (Padre/Madre)';
    }

    // 5. Portal de Padres: Estudiante seleccionado
    const parentActiveChildName = document.getElementById('parentActiveChildName');
    if (parentActiveChildName) {
      parentActiveChildName.textContent = 'Nombre del Estudiante';
    }

    // 6. Portal de Padres: Fichas de Hijos e iniciales
    document.querySelectorAll('#viewPadres div, #viewPadres span, #viewPadres strong, #viewPadres h4').forEach(el => {
      if (el.children.length === 0 && el.textContent.trim() === 'MA') {
        el.textContent = 'NE';
      }
    });

    document.querySelectorAll('#parentHijosList > div, .parent-child-card').forEach(card => {
      const strong = card.querySelector('strong');
      if (strong && (strong.textContent.includes('Mateo') || strong.textContent.includes('Alvarado'))) {
        strong.textContent = 'Nombre del Estudiante';
      }
    });

    // 7. Subvista SINPE Móvil
    const sinpeBanner = document.querySelector('#parentSubViewSinpe');
    if (sinpeBanner) {
      walkTextNodes(sinpeBanner);
      sinpeBanner.querySelectorAll('div, span, button').forEach(el => {
        if (el.textContent.trim() === 'MA') el.textContent = 'NE';
      });
    }

    // Pasada final de seguridad
    walkTextNodes(document.body);
  });
}

async function captureScreen(page, outPath) {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: outPath, type: 'png' });
  const buf = fs.readFileSync(outPath);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const kb = Math.round(buf.length / 1024);
  console.log(`   ✓ Guardado: ${path.basename(outPath)} (${w}x${h} px, ${kb} KB)`);
}

async function run() {
  console.log('========================================================================');
  console.log('📸 GENERADOR DE SCREENSHOTS OFICIALES ANONIMIZADOS (APPLE & GOOGLE STORE)');
  console.log('========================================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--hide-scrollbars']
  });

  for (const preset of PRESETS) {
    console.log(`\n📱 Procesando preset: ${preset.description}`);
    const outDir = path.join(BASE_OUT_DIR, preset.name);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const page = await browser.newPage();
    await page.setViewport({
      width: preset.width,
      height: preset.height,
      deviceScaleFactor: preset.scale
    });

    // -------------------------------------------------------------
    // 1. PANTALLA DE BIENVENIDA / SPLASH LOGIN
    // -------------------------------------------------------------
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(700);
    await anonymizeNamesInPage(page);
    await captureScreen(page, path.join(outDir, '01_Bienvenida_Login_SiboPay.png'));

    // -------------------------------------------------------------
    // 2. MODAL INFERIOR (BOTTOM SHEET) INICIO DE SESIÓN
    // -------------------------------------------------------------
    await page.evaluate(() => {
      if (typeof openLoginSheet === 'function') openLoginSheet('login');
    });
    await sleep(600);
    await anonymizeNamesInPage(page);
    await captureScreen(page, path.join(outDir, '02_Acceso_Seguro_BottomSheet.png'));

    // -------------------------------------------------------------
    // 3. MONEDERO ESTUDIANTIL & CARNÉ QR (ANONIMIZADO)
    // -------------------------------------------------------------
    await page.evaluate(async () => {
      document.getElementById('loginUsername').value = 'mateo';
      document.getElementById('loginPassword').value = '1234';
      await handleLoginSubmit();
    });
    await sleep(1500);

    // Abrir Modal de Carné QR
    await page.evaluate(() => {
      if (typeof openQrModal === 'function') openQrModal();
    });
    await sleep(800);
    await anonymizeNamesInPage(page);
    await captureScreen(page, path.join(outDir, '03_Carne_Digital_QR_Estudiante.png'));

    // -------------------------------------------------------------
    // 4. CATÁLOGO DE LA SODA ESCOLAR & PRODUCTOS (ANONIMIZADO)
    // -------------------------------------------------------------
    await page.evaluate(() => {
      if (typeof closeQrModal === 'function') closeQrModal();
    });
    await sleep(600);
    await anonymizeNamesInPage(page);
    await captureScreen(page, path.join(outDir, '04_Catalogo_Soda_Escolar.png'));

    // -------------------------------------------------------------
    // 5. PORTAL PARENTAL (MONITOREO DE HIJOS Y SALDOS ANONIMIZADOS)
    // -------------------------------------------------------------
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle2' });
    await page.evaluate(async () => {
      document.getElementById('loginUsername').value = 'padre';
      document.getElementById('loginPassword').value = 'padre123';
      await handleLoginSubmit();
    });
    await sleep(1800);
    await anonymizeNamesInPage(page);
    await captureScreen(page, path.join(outDir, '05_Portal_Padres_Monitoreo.png'));

    // -------------------------------------------------------------
    // 6. RECARGA OFICIAL POR SINPE MÓVIL (ANONIMIZADO)
    // -------------------------------------------------------------
    await page.evaluate(() => {
      if (typeof openParentSubView === 'function') openParentSubView('sinpe');
    });
    await sleep(800);
    await anonymizeNamesInPage(page);
    await captureScreen(page, path.join(outDir, '06_Recarga_SINPE_Movil.png'));

    // -------------------------------------------------------------
    // 7. TERMINAL POS Y CAJA RÁPIDA DE LA SODA ESCOLAR
    // -------------------------------------------------------------
    await page.goto(POS_URL, { waitUntil: 'networkidle2' });
    await sleep(1200);
    await anonymizeNamesInPage(page);
    await captureScreen(page, path.join(outDir, '07_Terminal_POS_Caja_Soda.png'));

    await page.close();
  }

  await browser.close();
  console.log('\n========================================================================');
  console.log('🎉 ¡TODOS LOS SCREENSHOTS ANONIMIZADOS FUERON GENERADOS CON ÉXITO!');
  console.log(`📁 Carpeta principal: ${BASE_OUT_DIR}`);
  console.log('========================================================================\n');
}

run().catch(err => {
  console.error('Error fatal durante la generación de screenshots:', err);
  process.exit(1);
});
