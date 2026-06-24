/**
 * loteLogic.js
 *
 * Logica de negocio PORTADA Y VERIFICADA contra el archivo original
 * lean-labels-requisiciones-demo.html (subido y revisado linea por linea).
 * Verificada tambien contra el ejemplo real impreso en FORM-21920:
 *   Lot # = AC2617303A, Fecha de Manufactura = 2026-06-22
 *   -> AC + "26" + "173" (dia del anio de 2026-06-22) + "03" + "A" (Doboy A)
 * Ver CLAUDE.md para el detalle de la verificacion.
 */

const PLANT_CODE = 'AC';

// Los 5 codigos reales con regla de expiracion a 3 anios (confirmado contra
// el catalogo embebido del demo Y contra ExcelRequisiciones.xlsx). Son
// variantes especificas de los 3 codigos base que menciona WI-29566
// 6.8.2.1 (77885, 44642, 88227) - el WI lista los codigos DC base, el
// catalogo real lista las variantes especificas (Codigo Pre Steril).
const SHORT_EXP_CODES = ['70219294', '70219058', '70219315', '70216181', '70202685'];
const THERMAL_DOBOY_AREA = 'Thermal Doboy';

function pad(n, w) {
  return String(n).padStart(w, '0');
}

// Idéntico al dayOfYear() del demo original.
function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

// Idéntico al addYears() del demo original (construye en hora local,
// evita el corrimiento de día por UTC).
function addYears(iso, years) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y + years, m - 1, d);
  return dt.toISOString().slice(0, 10);
}

/**
 * Fecha de expiración: Thermal Doboy -> +1 año (checado primero);
 * código en SHORT_EXP_CODES -> +3 años; todo lo demás -> +5 años.
 * @param {string} mfgIso fecha de manufactura 'YYYY-MM-DD'
 * @param {string} codigoCatalogo el "Codigo Pre Steril" (llave de catálogo)
 * @param {string} areaName nombre del área, ej. 'Thermal Doboy'
 */
function computeExpDate(mfgIso, codigoCatalogo, areaName) {
  if (!mfgIso) return '';
  let years = 5;
  if (areaName === THERMAL_DOBOY_AREA) years = 1;
  else if (SHORT_EXP_CODES.includes(String(codigoCatalogo))) years = 3;
  return addYears(mfgIso, years);
}

/**
 * On Pack Product # = primeros 5 caracteres de Código DC, PERO solo si la
 * cantidad de On Pack calculada es mayor a 0 — si es 0, el valor real es
 * "N/A" (no hay etiquetas On Pack que requieran ese número).
 */
function deriveOnPack(codigoDC, onPackQty) {
  if (!onPackQty || onPackQty === 0) return 'N/A';
  return codigoDC ? codigoDC.slice(0, 5) : '';
}

/**
 * Calcula las 6 cantidades reales (caja, bolsa, insert, on_pack, tbox,
 * opbox) multiplicando la cantidad pedida por los multiplicadores del
 * catálogo. dfu_manual se captura aparte (no es catálogo-driven).
 */
function computeCantidades(cantidad, catalogEntry) {
  const qty = parseInt(cantidad, 10) || 0;
  if (!catalogEntry) {
    return { caja: 0, bolsa: 0, insert: 0, on_pack: 0, tbox: 0, opbox: 0 };
  }
  return {
    caja: qty * (catalogEntry.mult_caja || 0),
    bolsa: qty * (catalogEntry.mult_bolsa || 0),
    insert: qty * (catalogEntry.mult_insert || 0),
    on_pack: qty * (catalogEntry.mult_on_pack || 0),
    tbox: qty * (catalogEntry.mult_tbox || 0),
    opbox: qty * (catalogEntry.mult_opbox || 0),
  };
}

/**
 * Construye el número de lote completo: PLANT_CODE + año-de-HOY(2d) +
 * día-del-año-de-FechaProduccion(3d) + secuencia(2d) + letra-de-área.
 * El año viene de HOY (fecha de captura), NO del año de fecha_produccion
 * — esto es así en el sistema real, confirmado en el archivo original.
 */
function construirNumeroLote({ areaLetra, fechaProduccionIso, secuencia }) {
  const todayYr = pad(new Date().getFullYear() % 100, 2);
  const prodDate = new Date(fechaProduccionIso + 'T00:00:00');
  const jd = pad(dayOfYear(prodDate), 3);
  const seqStr = pad(secuencia, 2);
  return {
    numero_lote: PLANT_CODE + todayYr + jd + seqStr + areaLetra,
    anio_2d: todayYr,
    dia_juliano: jd,
  };
}

module.exports = {
  PLANT_CODE,
  SHORT_EXP_CODES,
  THERMAL_DOBOY_AREA,
  computeExpDate,
  deriveOnPack,
  computeCantidades,
  construirNumeroLote,
  dayOfYear,
  addYears,
  pad,
};
