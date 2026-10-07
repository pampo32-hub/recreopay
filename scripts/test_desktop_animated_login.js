const path = require('path');
const puppeteer = require('puppeteer-core');
const express = require('express');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 3033;
const OUT_DIR = path.join(__dirname, '../screenshots/desktop_preview');

async function main() {
  const fs = require('fs');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = express();
  app.use(express.static(path.join(__dirname, '../public')));
  
  const server = app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    try {
      const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle2' });

      // Verify computed style of .splash-doodle-bg
      const animInfo = await page.evaluate(() => {
        const el = document.querySelector('.splash-doodle-bg');
        if (!el) return null;
        const style = window.getComputedStyle(el);
        return {
          animation: style.animation,
          animationName: style.animationName,
          animationDuration: style.animationDuration,
          backgroundSize: style.backgroundSize
        };
      });
      console.log('Animation Info:', animInfo);

      const outPath = path.join(OUT_DIR, 'Login_Desktop_Fondo_Animado.png');
      await page.screenshot({ path: outPath, type: 'png' });
      console.log('✓ Guardado screenshot desktop:', outPath);

      await browser.close();
      server.close();
      process.exit(0);
    } catch (err) {
      console.error(err);
      server.close();
      process.exit(1);
    }
  });
}

main();
