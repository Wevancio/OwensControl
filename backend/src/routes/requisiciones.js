const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const {
  calcularFechaExpiracion,
  calcularOnPackNumero,
  calcularEtiquetasCaja,
  construirNumeroLote,
} = require('../loteLogic');

// Transiciones de estado permitidas (mismo flujo de 5 estados del demo original)
const TRANSICIONES_VALIDAS = {
  pendiente: ['en_impresion', 'rechazada', 'cancelada'],
  en_impresion: ['lista', 'cancelada'],
  lista: [],
  rechazada: [],
  cancelada: [],
};

async function registrarAuditoria(requisicion_id, usuario, accion, detalle) {
  await supabase.from('auditoria').insert({ requisicion_id, usuario, accion, detalle });
}

// GET /api/requisiciones?area_id=&estado=&fecha_produccion=
router.get('/', async (req, res) => {
  const { area_id, estado, fecha_produccion } = req.query;

  let query = supabase
    .from('requisiciones')
    .select('*, areas(nombre, letra), catalogo_productos(descripcion)')
    .order('creado_en', { ascending: false });

  if (area_id) query = query.eq('area_id', area_id);
  if (estado) query = query.eq('estado', estado);
  if (fecha_produccion) query = query.eq('fecha_produccion', fecha_produccion);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/requisiciones — crea una nueva requisición con secuencia de lote atómica
router.post('/', async (req, res) => {
  const {
    semana, orden, orden_particionada, codigo_dc, cantidad,
    fecha_produccion, area_id, dfu_manual, solicitante, notas,
    fecha_manufactura,
  } = req.body;

  // --- Validaciones básicas de entrada ---
  if (!orden || !codigo_dc || !cantidad || !fecha_produccion || !area_id || !solicitante) {
    return res.status(400).json({
      error: 'Faltan campos obligatorios: orden, codigo_dc, cantidad, fecha_produccion, area_id, solicitante',
    });
  }
  if (Number(cantidad) <= 0) {
    return res.status(400).json({ error: 'cantidad debe ser mayor a 0' });
  }

  // --- Obtener área y producto (necesarios para las reglas de negocio) ---
  const { data: area, error: errArea } = await supabase
    .from('areas').select('*').eq('id', area_id).single();
  if (errArea || !area) return res.status(400).json({ error: 'Área no válida' });

  const { data: producto, error: errProd } = await supabase
    .from('catalogo_productos').select('*').eq('codigo_dc', codigo_dc).single();
  if (errProd || !producto) {
    return res.status(400).json({ error: `Código ${codigo_dc} no existe en el catálogo` });
  }

  try {
    // --- Paso 1: secuencia atómica (anti-duplicado real, a nivel de DB) ---
    const { data: secuencia, error: errSeq } = await supabase
      .rpc('siguiente_secuencia_lote', { p_area_id: area_id, p_fecha: fecha_produccion });
    if (errSeq) throw new Error(`No se pudo generar secuencia de lote: ${errSeq.message}`);

    // --- Paso 2: construir campos derivados ---
    const fechaMfg = fecha_manufactura || fecha_produccion;
    const numero_lote = construirNumeroLote({
      areaLetra: area.letra,
      fechaProduccionISO: fecha_produccion,
      secuencia,
    });
    const fecha_expiracion = calcularFechaExpiracion(fechaMfg, area, producto);
    const on_pack_numero = calcularOnPackNumero(codigo_dc);
    const etiquetas_caja = calcularEtiquetasCaja(cantidad, producto.etiquetas_caja_multiplicador);

    // --- Paso 3: insertar. El UNIQUE constraint de numero_lote es la última
    //     línea de defensa si, por cualquier motivo, dos lotes coincidieran. ---
    const { data: nueva, error: errInsert } = await supabase
      .from('requisiciones')
      .insert({
        semana, orden, orden_particionada, codigo_dc, cantidad,
        fecha_produccion, area_id, secuencia, numero_lote,
        fecha_manufactura: fechaMfg, fecha_expiracion, on_pack_numero,
        etiquetas_caja, dfu_manual, solicitante, notas,
      })
      .select()
      .single();

    if (errInsert) {
      if (errInsert.code === '23505') {
        // Duplicado real detectado por la base de datos.
        return res.status(409).json({
          error: 'Número de lote duplicado detectado por la base de datos. Intenta de nuevo.',
          detalle: errInsert.message,
        });
      }
      throw errInsert;
    }

    await registrarAuditoria(nueva.id, solicitante, 'creada', { numero_lote });
    res.status(201).json(nueva);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/requisiciones/:id/estado — cambia estado validando la transición
router.patch('/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { nuevo_estado, usuario } = req.body;

  if (!nuevo_estado || !usuario) {
    return res.status(400).json({ error: 'Faltan nuevo_estado y usuario' });
  }

  const { data: actual, error: errGet } = await supabase
    .from('requisiciones').select('estado').eq('id', id).single();
  if (errGet || !actual) return res.status(404).json({ error: 'Requisición no encontrada' });

  const permitidas = TRANSICIONES_VALIDAS[actual.estado] || [];
  if (!permitidas.includes(nuevo_estado)) {
    return res.status(409).json({
      error: `Transición no válida: ${actual.estado} -> ${nuevo_estado}. Permitidas desde "${actual.estado}": ${permitidas.join(', ') || 'ninguna (estado final)'}`,
    });
  }

  const { data: actualizada, error: errUpdate } = await supabase
    .from('requisiciones').update({ estado: nuevo_estado }).eq('id', id).select().single();
  if (errUpdate) return res.status(500).json({ error: errUpdate.message });

  await registrarAuditoria(id, usuario, `estado:${actual.estado}->${nuevo_estado}`, {});
  res.json(actualizada);
});

module.exports = router;
