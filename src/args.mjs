// Parser de argumentos y ayuda. Sin dependencias, con alias en castellano e ingles.

import { c } from './util.mjs';

const BOOLEANOS = new Set([
  'cancelacion-gratis', 'todos', 'headful', 'json', 'ayuda', 'help', 'sin-guardar',
  'solo-bajaron', 'silencioso', 'version', 'instalar', 'quitar',
]);

const ALIAS = {
  fecha: 'noche', checkin: 'noche', 'check-in': 'noche', dia: 'noche',
  los: 'noches', n: 'noches',
  adults: 'adultos', children: 'ninos', 'niños': 'ninos', rooms: 'habitaciones', hab: 'habitaciones',
  currency: 'moneda', cur: 'moneda',
  pages: 'paginas', p: 'paginas',
  sort: 'orden', o: 'orden',
  'max-precio': 'max', 'precio-max': 'max', hasta: 'max',
  'min-precio': 'min', desde: 'min',
  'nota-min': 'min-nota', 'reviews-min': 'min-reviews', 'estrellas-min': 'min-estrellas',
  type: 'tipo', area: 'zona', barrio: 'zona', 'sin-barrio': 'sin-zona', excluir: 'sin-zona',
  near: 'cerca', radius: 'radio',
  limit: 'limite', l: 'limite',
  every: 'cada', until: 'hasta-hora', repeticiones: 'veces',
  q: 'texto', buscar: 'texto',
};

/** argv -> { comando, positional, opciones }. */
export function parsear(argv) {
  const out = { comando: null, pos: [], op: {} };
  const args = [...argv];

  while (args.length) {
    const a = args.shift();
    if (a === '--') { out.pos.push(...args); break; }

    if (a.startsWith('--')) {
      let [clave, ...resto] = a.slice(2).split('=');
      clave = ALIAS[clave] ?? clave;
      let valor = resto.length ? resto.join('=') : undefined;
      if (valor === undefined) {
        if (BOOLEANOS.has(clave)) valor = true;
        else if (args.length && !args[0].startsWith('--')) valor = args.shift();
        else valor = true;
      }
      out.op[clave] = valor;
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const clave = ALIAS[a.slice(1)] ?? a.slice(1);
      out.op[clave] = BOOLEANOS.has(clave) ? true : (args.length && !args[0].startsWith('--') ? args.shift() : true);
    } else if (!out.comando) {
      out.comando = a;
    } else {
      out.pos.push(a);
    }
  }
  return out;
}

const B = (s) => c('bold', s);
const G = (s) => c('gray', s);

export const AYUDA = `
${B('agoda')} — extrae, filtra y sigue precios de Agoda.

${B('COMANDOS')}
  ${B('buscar')} <destino>      Baja las publicaciones, las guarda y las muestra ordenadas.
  ${B('ver')}                   Muestra el ultimo resultado guardado (sin tocar internet).
  ${B('bajadas')}               Ranking de cuanto bajo cada precio desde que lo seguis.
  ${B('comparar')}              Hoy contra la noche anterior, a la misma hora del dia.
  ${B('seguir')} <destino>      Toma muestras cada X minutos y avisa cuando algo baja.
  ${B('historial')} <id|nombre> Curva de precio de un alojamiento.
  ${B('reporte')}               Genera un HTML filtrable con todo lo guardado.
  ${B('buscas')}                Lista las busquedas que venis siguiendo.
  ${B('destinos')} <texto>      Resuelve el id de ciudad de Agoda.
  ${B('programar')} <destino>   Deja el seguimiento corriendo solo, hora a hora.
  ${B('horarios')}              A que hora del dia suele convenir reservar.
  ${B('estado')}                Si la automatizacion esta corriendo y con que huecos.

${B('BUSQUEDA')}
  --noche <f>          Fecha de entrada: hoy (por defecto), manana, +3, viernes, 05/09, 2026-09-05
  --noches <n>         Cuantas noches (1)
  --adultos <n>        (2)   --ninos <n> (0)   --habitaciones <n> (1)
  --moneda <cod>       ARS por defecto. USD, EUR, BRL...
  --paginas <n>        Paginas de 100 resultados a bajar (3 = los 300 mas baratos)
  --url <url>          Usar una URL de Agoda ya armada (respeta los filtros que pusiste ahi)

${B('FILTROS')}   ${G('(se aplican sobre lo bajado, no dependen de los filtros de Agoda)')}
  --max <n>            Precio maximo por noche        --min <n> minimo
  --max-total <n>      Tope del total de la estadia
  --min-nota <n>       Nota minima (ej 8)             --min-reviews <n> opiniones minimas
  --min-estrellas <n>  Estrellas minimas
  --tipo <lista>       depto, casa, hogar, hotel, hostel, bb, todos o ids (ej: depto,casa)
  --zona <lista>       Barrios a incluir (ej: palermo,recoleta)
  --sin-zona <lista>   Barrios a excluir
  --cerca <lat,lon>    Filtra por distancia a un punto     --radio <km> (3)
  --cancelacion-gratis Solo con cancelacion gratis
  --texto <t>          El nombre tiene que contener esto
  --todos              Incluir los que estan sin disponibilidad

${B('SALIDA')}
  --orden <o>          precio (por defecto), total, nota, valor, bajada, descuento, distancia, reviews, nombre
  --limite <n>         Cuantas filas mostrar (30)
  --desde <horas>      Comparar solo contra las ultimas N horas (ver, bajadas)
  --busqueda <id>      Sobre que busqueda guardada trabajar (ver "agoda buscas")
  --csv <archivo>      Exporta a CSV      --html <archivo> reporte navegable
  --fotos <modo>       url (por defecto), incrustadas (archivo autonomo) o ninguna
  --fotos-ancho <px>   Ancho de las miniaturas (400)
  --json               Volca JSON crudo por stdout

${B('SEGUIMIENTO')}   ${G('(comando seguir)')}
  --cada <min>         Cada cuanto muestrear (20)
  --veces <n>          Cuantas muestras tomar (sin limite)
  --hasta-hora <hh:mm> Cortar a esa hora
  --avisar-si <pct>    Avisar si algo baja mas de este % (10)
  --avisar-bajo <n>    Avisar si algo queda por debajo de este precio
  --avisar-con <cmd>   Comando a ejecutar en cada aviso (recibe $AGODA_NOMBRE, $AGODA_PRECIO, $AGODA_URL...)

${B('COMPARAR NOCHES')}   ${G('(comando comparar)')}
  --contra <n>         Contra cuantas noches atras (1)
  --hora <h>           Cruzar a esa hora en vez de la ultima muestra
  --tolerancia <min>   Cuanto puede desviarse la hora al cruzar (90)
  --base <modo>        auto (por defecto): misma hora, y donde no hay, el mejor
                       precio de esa noche. hora: solo misma hora. mejor: solo
                       contra el mejor precio de esa noche

${B('AUTOMATICO')}   ${G('(comando programar: corre aunque cierres la terminal)')}
  --cada <min>         Cada cuanto muestrear; tiene que dividir a 60 (60)
  --desde-hora <h>     Desde que hora arranca (12)
  --hasta-hora <h>     Hasta que hora (23)
  --html <archivo>     Que reporte regenerar en cada corrida (reportes/hoy.html)
  --registro <archivo> Donde dejar el log (data/agoda.log)
  --instalar           Ponerla en el crontab (si no, solo la muestra)
  --quitar             Sacarla del crontab
  ${G('Los filtros y opciones de busqueda que pongas se arrastran a la tarea.')}

${B('HORARIOS')}   ${G('(comando horarios)')}
  --dias <n>           Cuantas noches para atras analizar (30)
  --min-muestras <n>   Muestras minimas para opinar de una hora (5)
  --criterio <c>       Que define la mejor hora:
                       mediana (por defecto) la hora mas barata para uno cualquiera
                       promedio             mayor descuento promedio (geometrico)
                       minimos              donde mas seguido cae el minimo del dia
  ${G('Acepta los filtros: podes preguntar solo por deptos, o solo por una zona.')}

${B('EJEMPLOS')}
  ${G('# deptos en Buenos Aires para esta noche, hasta 60 mil, con nota 8+')}
  agoda buscar "Buenos Aires" --tipo depto --max 60000 --min-nota 8 --min-reviews 20

  ${G('# los mas baratos cerca del Obelisco, 2 km a la redonda')}
  agoda buscar "Buenos Aires" --cerca -34.6037,-58.3816 --radio 2 --orden precio

  ${G('# seguir los precios toda la tarde y avisar si algo baja 15%')}
  agoda seguir "Buenos Aires" --tipo depto --cada 20 --hasta-hora 21:00 --avisar-si 15

  ${G('# cuanto bajo cada uno desde que empece a mirar')}
  agoda bajadas --limite 20

  ${G('# esta noche a las 19 contra anoche a las 19')}
  agoda comparar --hora 19

  ${G('# a que hora conviene reservar deptos, segun lo que venis midiendo')}
  agoda horarios --tipo depto,casa

  ${G('# la automatizacion, esta corriendo?')}
  agoda estado

  ${G('# reporte HTML para abrir en el navegador')}
  agoda reporte --html reportes/hoy.html

  ${G('# que se actualice solo, cada hora, de 12 a 23')}
  agoda programar "Buenos Aires" --tipo depto,casa --cada 60 --instalar

${B('VARIABLES')}
  AGODA_DB       ruta de la base (por defecto ./data/agoda.db)
  AGODA_CHROME   ruta a un Chrome/Chromium propio
`;
