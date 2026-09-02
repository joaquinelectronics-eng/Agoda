// Aviso amable despues de npm install: si no hay Chromium, decimos como conseguirlo.
import { resolverChromium } from '../src/browser.mjs';

const ruta = await resolverChromium().catch(() => null);
if (ruta) {
  console.log(`agoda-tracker: navegador listo (${ruta})`);
} else {
  console.log('agoda-tracker: falta el navegador. Corre:  node node_modules/playwright-core/cli.js install chromium');
}
