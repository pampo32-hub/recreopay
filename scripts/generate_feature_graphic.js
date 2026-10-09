const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_PATH = path.join(__dirname, '../screenshots/google_play_store/feature_graphic_1024x500.png');
const EMBLEM_PATH = path.join(__dirname, '../public/img/sibopay-emblem.png');

async function generate() {
  const emblemBase64 = fs.readFileSync(EMBLEM_PATH).toString('base64');
  const emblemSrc = `data:image/png;base64,${emblemBase64}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    body {
      width: 1024px;
      height: 500px;
      background: radial-gradient(circle at 75% 30%, #0369a1 0%, #052036 60%, #021220 100%);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 70px;
      color: #ffffff;
      overflow: hidden;
      position: relative;
    }
    .accent-circle {
      position: absolute;
      width: 450px;
      height: 450px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(2, 132, 199, 0.25) 0%, transparent 70%);
      top: -80px;
      right: 120px;
      pointer-events: none;
    }
    .left {
      max-width: 580px;
      z-index: 2;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(2, 132, 199, 0.25);
      border: 1px solid rgba(56, 189, 248, 0.4);
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      color: #7dd3fc;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 18px;
    }
    h1 {
      font-size: 54px;
      font-weight: 900;
      letter-spacing: -1px;
      line-height: 1.1;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #ffffff 40%, #bae6fd 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      font-size: 20px;
      color: #94a3b8;
      font-weight: 500;
      line-height: 1.4;
      margin-bottom: 24px;
    }
    .features {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .feature-pill {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 7px 14px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      color: #e2e8f0;
      backdrop-filter: blur(10px);
    }
    .right {
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-card {
      width: 220px;
      height: 220px;
      background: rgba(255, 255, 255, 0.05);
      border: 2px solid rgba(56, 189, 248, 0.3);
      border-radius: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 25px 60px -15px rgba(2, 132, 199, 0.5), inset 0 0 25px rgba(255,255,255,0.1);
      backdrop-filter: blur(16px);
    }
    .logo-img {
      width: 140px;
      height: 140px;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <div class="accent-circle"></div>
  <div class="left">
    <div class="badge">
      <span>⚡ Plataforma Digital</span>
    </div>
    <h1>SiboPay</h1>
    <p>Pagos rápidos, transferencias y monedero digital seguro.</p>
    <div class="features">
      <div class="feature-pill">💳 Monedero Digital</div>
      <div class="feature-pill">🔒 QR con Biometría</div>
      <div class="feature-pill">⚡ Transferencias P2P</div>
      <div class="feature-pill">📊 Control de Consumo</div>
    </div>
  </div>
  <div class="right">
    <div class="logo-card">
      <img src="${emblemSrc}" class="logo-img" alt="SiboPay Logo">
    </div>
  </div>
</body>
</html>
  `;

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1024,500']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 500, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: OUT_PATH, type: 'png' });
  await browser.close();

  console.log('✅ Feature Graphic generado exitosamente en:', OUT_PATH);
}

generate().catch(console.error);
