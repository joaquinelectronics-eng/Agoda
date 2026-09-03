// Arranque de Chromium via playwright-core, con las manias de cada entorno resueltas.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { warn } from './util.mjs';

// playwright-core se carga solo cuando hace falta navegador: asi los comandos que
// leen la base (ver, bajadas, reporte) andan sin tenerlo instalado.
let _chromium = null;
async function cargarChromium() {
  if (_chromium) return _chromium;
  try {
    ({ chromium: _chromium } = await import('playwright-core'));
  } catch {
    throw new Error('Falta playwright-core. Instalalo con:  npm install');
  }
  return _chromium;
}

const UA_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

// Agoda no le muestra lo mismo a un telefono que a una computadora, asi que hace
// falta poder pedir la version movil para comparar contra lo que ve el usuario.
const UA_MOVIL =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/17.6 Mobile/15E148 Safari/604.1';

const CANDIDATOS = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

// Donde playwright guarda los navegadores segun el sistema.
function carpetasDeNavegadores() {
  const dirs = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    dirs.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }
  const home = os.homedir();
  if (process.platform === 'darwin') dirs.push(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  else if (process.platform === 'win32') dirs.push(path.join(process.env.LOCALAPPDATA ?? home, 'ms-playwright'));
  else dirs.push(path.join(home, '.cache', 'ms-playwright'));
  return dirs;
}

const BINARIOS = [
  ['chrome-linux', 'chrome'],
  ['chrome-linux64', 'chrome'],
  ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-win', 'chrome.exe'],
];

/**
 * Cualquier chromium-<rev> que haya en las carpetas de playwright, el mas nuevo primero.
 * Sirve cuando la version de playwright-core no coincide justo con el navegador bajado.
 */
function chromiumsInstalados() {
  const hallados = [];
  for (const dir of carpetasDeNavegadores()) {
    let entradas;
    try { entradas = fs.readdirSync(dir); } catch { continue; }
    for (const e of entradas) {
      const m = /^chromium-(\d+)$/.exec(e);          // el headless_shell no sirve para esto
      if (!m) continue;
      for (const rel of BINARIOS) {
        const bin = path.join(dir, e, ...rel);
        if (fs.existsSync(bin)) { hallados.push({ rev: Number(m[1]), bin }); break; }
      }
    }
  }
  return hallados.sort((a, b) => b.rev - a.rev).map((x) => x.bin);
}

/** Busca un Chromium usable: el de playwright, otro que haya bajado, o uno del sistema. */
export async function resolverChromium() {
  if (process.env.AGODA_CHROME) return process.env.AGODA_CHROME;
  try {
    const p = (await cargarChromium()).executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* playwright no esta instalado */ }
  const [otro] = chromiumsInstalados();
  if (otro) return otro;
  for (const p of CANDIDATOS) if (fs.existsSync(p)) return p;
  return null;
}

/**
 * Abre navegador + contexto listos para Agoda.
 * Devuelve { browser, ctx, page, cerrar }.
 */
export async function abrirNavegador({
  headful = false, locale = 'es-AR', timezone = 'America/Argentina/Buenos_Aires', movil = false,
} = {}) {
  const chromium = await cargarChromium();
  const executablePath = await resolverChromium();
  if (!executablePath) {
    throw new Error(
      'No encontre Chromium. Instalalo con:  node node_modules/playwright-core/cli.js install chromium\n' +
      '(o apunta la variable AGODA_CHROME a un Chrome/Chromium existente)'
    );
  }

  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'];
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;

  // Detras de un proxy que re-termina TLS (corporativo o sandbox), el ClientHello
  // grande de Chrome con TLS 1.3 + post-quantum hace que el tunel se corte solo.
  // Bajar a TLS 1.2 lo arregla y solo afecta el tramo navegador <-> proxy local.
  if (proxyUrl && process.env.AGODA_NO_TLS_DOWNGRADE !== '1') args.push('--ssl-version-max=tls1.2');

  const browser = await chromium.launch({
    executablePath,
    headless: !headful,
    args,
    ...(proxyUrl ? { proxy: { server: proxyUrl } } : {}),
  });

  const ctx = await browser.newContext({
    userAgent: movil ? UA_MOVIL : UA_DESKTOP,
    ...(movil
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
      : { viewport: { width: 1440, height: 900 } }),
    locale,
    timezoneId: timezone,
    ignoreHTTPSErrors: Boolean(proxyUrl),
  });

  // Menos ruido y menos trafico: no bajamos fotos ni fuentes ni trackers.
  await ctx.route('**/*', (route) => {
    const req = route.request();
    const tipo = req.resourceType();
    if (tipo === 'image' || tipo === 'media' || tipo === 'font') return route.abort();
    const u = req.url();
    if (/googletagmanager|google-analytics|doubleclick|criteo|adsrvr|facebook\.net|hotjar|clarity\.ms/.test(u)) {
      return route.abort();
    }
    return route.continue();
  });

  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);

  const cerrar = async () => { try { await browser.close(); } catch { /* ya cerrado */ } };
  return { browser, ctx, page, cerrar };
}

export function avisarProxy() {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    warn('Usando HTTPS_PROXY para el navegador.');
  }
}
