const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const {
  computeExpDate,
  deriveOnPack,
  computeCantidades,
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
    .select('*, areas(nombre, letra), catalogo_productos(codigo_dc, codigo_alterno)')
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
    semana, orden, orden_particionada, codigo_catalogo, cantidad,
    fecha_produccion, area_id, dfu_manual, urgencia, solicitante, notas,
    fecha_manufactura,
  } = req.body;

  // --- Validaciones básicas de entrada ---
  if (!orden || !codigo_catalogo || !cantidad || !fecha_produccion || !area_id || !solicitante) {
    return res.status(400).json({
      error: 'Faltan campos obligatorios: orden, codigo_catalogo, cantidad, fecha_produccion, area_id, solicitante',
    });
  }
  if (Number(cantidad) <= 0) {
    return res.status(400).json({ error: 'cantidad debe ser mayor a 0' });
  }
  const dfuManualNum = parseInt(dfu_manual, 10) || 0;
  const urgenciaVal = urgencia === 'Urgente' ? 'Urgente' : 'Normal';

  // --- Obtener área y producto (necesarios para las reglas de negocio) ---
  const { data: area, error: errArea } = await supabase
    .from('areas').select('*').eq('id', area_id).single();
  if (errArea || !area) return res.status(400).json({ error: 'Área no válida' });

  const { data: producto, error: errProd } = await supabase
    .from('catalogo_productos').select('*').eq('codigo_catalogo', codigo_catalogo).single();
  if (errProd || !producto) {
    return res.status(400).json({ error: `Código ${codigo_catalogo} no existe en el catálogo` });
  }

  try {
    // --- Paso 1: construir el numero_lote candidato (incluye anio_2d y dia_juliano) ---
    // La secuencia se obtiene de forma atomica DESPUES, pero necesitamos
    // anio_2d/dia_juliano primero para llamar a la funcion con la llave correcta.
    const previo = construirNumeroLote({ areaLetra: area.letra, fechaProduccionIso: fecha_produccion, secuencia: 1 });

    const { data: secuencia, error: errSeq } = await supabase
      .rpc('siguiente_secuencia_lote', {
        p_area_id: area_id,
        p_anio_2d: previo.anio_2d,
        p_dia_juliano: previo.dia_juliano,
      });
    if (errSeq) throw new Error(`No se pudo generar secuencia de lote: ${errSeq.message}`);

    const { numero_lote, anio_2d, dia_juliano } = construirNumeroLote({
      areaLetra: area.letra,
      fechaProduccionIso: fecha_produccion,
      secuencia,
    });

    // --- Paso 2: construir campos derivados ---
    const fechaMfg = fecha_manufactura || fecha_produccion;
    const fecha_expiracion = computeExpDate(fechaMfg, codigo_catalogo, area.nombre);
    const cant = computeCantidades(cantidad, producto);
    const on_pack_numero = deriveOnPack(producto.codigo_dc, cant.on_pack);

    // --- Paso 3: insertar. El UNIQUE constraint de numero_lote es la última
    //     línea de defensa si, por cualquier motivo, dos lotes coincidieran. ---
    const { data: nueva, error: errInsert } = await supabase
      .from('requisiciones')
      .insert({
        semana, orden, orden_particionada, codigo_catalogo, cantidad,
        fecha_produccion, area_id, anio_2d, dia_juliano, secuencia, numero_lote,
        fecha_manufactura: fechaMfg, fecha_expiracion, on_pack_numero,
        cantidad_caja: cant.caja, cantidad_bolsa: cant.bolsa, cantidad_insert: cant.insert,
        cantidad_on_pack: cant.on_pack, cantidad_tbox: cant.tbox, cantidad_opbox: cant.opbox,
        dfu_manual: dfuManualNum, urgencia: urgenciaVal, solicitante, notas,
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
  const { nuevo_estado, usuario, comentario, qnc } = req.body;

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

  // Igual que decidir()/marcarLista() del demo original: se registra quién
  // resolvió, el comentario/QNC si aplica, y la fecha correspondiente.
  const update = { estado: nuevo_estado };
  if (['en_impresion', 'rechazada', 'cancelada'].includes(nuevo_estado)) {
    update.evaluador = usuario;
    if (comentario) update.comentario = comentario;
    if (qnc) update.qnc = qnc;
    update.fecha_resolucion = new Date().toISOString();
  }
  if (nuevo_estado === 'lista') {
    update.fecha_lista = new Date().toISOString();
  }

  const { data: actualizada, error: errUpdate } = await supabase
    .from('requisiciones').update(update).eq('id', id).select().single();
  if (errUpdate) return res.status(500).json({ error: errUpdate.message });

  await registrarAuditoria(id, usuario, `estado:${actual.estado}->${nuevo_estado}`, { comentario, qnc });
  res.json(actualizada);
});

// PATCH /api/requisiciones/:id/conciliacion — guarda la grilla de Conciliación
// de Etiquetas (WI-29566 6.6) + los campos finales de FORM-21920.
router.patch('/:id/conciliacion', async (req, res) => {
  const { id } = req.params;
  const { conciliacion, qa_verified_by, totals_match, notas_finales, qnc, usuario } = req.body;

  if (totals_match && !['yes', 'no'].includes(totals_match)) {
    return res.status(400).json({ error: "totals_match debe ser 'yes' o 'no'" });
  }

  const update = {};
  if (conciliacion !== undefined) update.conciliacion = conciliacion;
  if (qa_verified_by !== undefined) update.qa_verified_by = qa_verified_by;
  if (totals_match !== undefined) update.totals_match = totals_match;
  if (notas_finales !== undefined) update.notas_finales = notas_finales;
  if (qnc !== undefined) update.qnc = qnc;

  const { data: actualizada, error } = await supabase
    .from('requisiciones').update(update).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await registrarAuditoria(id, usuario || 'desconocido', 'conciliacion_guardada', {});
  res.json(actualizada);
});

module.exports = router;
