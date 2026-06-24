/**
 * loteLogic.js
 *
 * Reglas de negocio confirmadas y validadas en sesiones anteriores contra
 * el Excel real (17,000 fórmulas recalculadas, 16 filas reales verificadas).
 *
 * ============================================================================
 * ADVERTENCIA — NO USAR EN PRODUCCIÓN SIN VERIFICAR:
 * La función `construirNumeroLote()` de este archivo es un PLACEHOLDER.
 * No se reconstruyó copiando la lógica exacta del archivo original
 * (lean-labels-requisiciones-demo.html) porque ese archivo no estaba
 * disponible en esta sesión. Antes de usar este sistema con datos reales,
 * hay que sustituir esta función por el algoritmo exacto ya validado.
 * Ver CLAUDE.md → "Pendientes" para el detalle de este punto.
 * ============================================================================
 */

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function diaDelAnio(date) {
  const d = new Date(date);
  const inicioAnio = new Date(d.getFullYear(), 0, 0);
  const diff = d - inicioAnio;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Calcula la fecha de expiración según las 3 ramas confirmadas:
 *   - Área Thermal Doboy            -> +1 año
 *   - Código marcado pre_esteril_3_anios -> +3 años
 *   - Todos los demás               -> +5 años
 *
 * @param {string} fechaManufacturaISO  'YYYY-MM-DD'
 * @param {{letra: string}} area
 * @param {{pre_esteril_3_anios: boolean}} producto
 */
function calcularFechaExpiracion(fechaManufacturaISO, area, producto) {
  const base = new Date(fechaManufacturaISO);

  if (area.letra === 'T') {
    return toISODate(addYears(base, 1));
  }
  if (producto.pre_esteril_3_anios) {
    return toISODate(addYears(base, 3));
  }
  return toISODate(addYears(base, 5));
}

/**
 * On Pack # = primeros 5 caracteres del Código DC (confirmado, no derivado
 * matemáticamente, valor literal del catálogo para Código Alterno aparte).
 */
function calcularOnPackNumero(codigoDC) {
  return String(codigoDC).slice(0, 5);
}

/**
 * Etiquetas de Caja = catálogo-driven, multiplicador casi siempre x2,
 * dos códigos confirmados con x1 (viven en catalogo_productos.etiquetas_caja_multiplicador).
 */
function calcularEtiquetasCaja(cantidad, multiplicadorCatalogo) {
  return cantidad * multiplicadorCatalogo;
}

/**
 * PLACEHOLDER — pendiente de reemplazar con la fórmula exacta.
 *
 * Lo que SÍ sabemos, confirmado en sesiones anteriores:
 *   - Usa el año actual (no necesariamente el año de fecha_produccion)
 *   - Usa el día-del-año calculado a partir de la Fecha de Producción
 *     capturada (no de la fecha de manufactura)
 *   - Hay una fecha ancla interna ("Año: 2025-12-31", 31-dic del año
 *     anterior) usada para la aritmética de día-del-año
 *   - Incorpora la letra de área y una secuencia diaria por área
 *
 * Ejemplo real de FORM-21920 para referencia/validación futura:
 *   Lot # = AC2617303A | Fecha de Manufactura = 2026-06-22
 *   (173 = día del año de 2026-06-22, consistente con la regla de día-del-año)
 *
 * No completar el resto del patrón a ciegas — falta el archivo original.
 */
function construirNumeroLote({ areaLetra, fechaProduccionISO, secuencia }) {
  const anioActual = new Date().getFullYear().toString().slice(-2);
  const doy = diaDelAnio(fechaProduccionISO).toString().padStart(3, '0');
  const seqStr = secuencia.toString().padStart(2, '0');

  // TODO: sustituir este armado por el algoritmo real validado.
  return `${areaLetra}${anioActual}${doy}${seqStr}`;
}

module.exports = {
  calcularFechaExpiracion,
  calcularOnPackNumero,
  calcularEtiquetasCaja,
  construirNumeroLote,
  diaDelAnio,
  toISODate,
};
