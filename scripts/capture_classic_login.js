const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PREVIEW_URL = 'http://localhost:3030/templates/preview-login-clasico.html';
const OUT_DIR = path.join(__dirname, '../screenshots/login_clasico_roles');

async function run() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  // 1. Captura en resolución móvil moderna (1080 x 2400 px)
  await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 3 });
  await page.goto(PREVIEW_URL, { waitUntil: 'networkidle2' });
  const outMobile = path.join(OUT_DIR, 'Login_Clasico_Roles_Padre_Estudiante_Personal.png');
  await page.screenshot({ path: outMobile, type: 'png' });
  console.log('✓ Guardado screenshot móvil:', outMobile);

  // 2. Captura con rol Estudiante seleccionado
  await page.evaluate(() => selectLoginRole('estudiante'));
  await new Promise(r => setTimeout(r, 400));
  const outEstudiante = path.join(OUT_DIR, 'Login_Clasico_Rol_Estudiante.png');
  await page.screenshot({ path: outEstudiante, type: 'png' });
  console.log('✓ Guardado screenshot estudiante:', outEstudiante);

  // 3. Captura con rol Personal de cocina seleccionado
  await page.evaluate(() => selectLoginRole('personal'));
  await new Promise(r => setTimeout(r, 400));
  const outPersonal = path.join(OUT_DIR, 'Login_Clasico_Rol_Personal_Cocina.png');
  await page.screenshot({ path: outPersonal, type: 'png' });
  console.log('✓ Guardado screenshot personal cocina:', outPersonal);

  await browser.close();
  console.log('¡Capturas del inicio de sesión clásico generadas con éxito!');
}

run().catch(console.error);
