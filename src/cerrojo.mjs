// Un cerrojo de archivo para que dos corridas programadas no se pisen.
//
// Si el cron dispara cada hora y una corrida se cuelga o tarda de mas, la
// siguiente arrancaria un segundo navegador y escribiria en la misma base al
// mismo tiempo. Con esto la segunda se va sin hacer ruido.

import fs from 'node:fs';
import path from 'node:path';

const vive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/**
 * Intenta tomar el cerrojo. Devuelve una funcion para soltarlo, o null si ya lo
 * tiene otra corrida viva. Un cerrojo huerfano (proceso muerto, o mas viejo que
 * maxEdadMin) se pisa: si no, un cuelgue dejaria todo trabado para siempre.
 */
export function tomarCerrojo(ruta, { maxEdadMin = 55 } = {}) {
  fs.mkdirSync(path.dirname(path.resolve(ruta)), { recursive: true });

  if (fs.existsSync(ruta)) {
    let previo = null;
    try { previo = JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { previo = null; }
    const edadMin = previo?.desde ? (Date.now() - new Date(previo.desde).getTime()) / 60000 : Infinity;
    if (previo?.pid && vive(previo.pid) && edadMin < maxEdadMin) {
      return { tomado: false, duenio: previo, edadMin };
    }
    try { fs.unlinkSync(ruta); } catch { /* ya no esta */ }
  }

  fs.writeFileSync(ruta, JSON.stringify({ pid: process.pid, desde: new Date().toISOString() }));
  let suelto = false;
  const soltar = () => {
    if (suelto) return;
    suelto = true;
    // Solo borramos si sigue siendo nuestro: otro pudo habernos pisado.
    try {
      const actual = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      if (actual.pid === process.pid) fs.unlinkSync(ruta);
    } catch { /* ya no esta */ }
  };
  return { tomado: true, soltar };
}
