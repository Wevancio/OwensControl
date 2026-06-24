const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET /api/catalogo?buscar=70220861 — búsqueda simple por código (para autocompletar en el form)
router.get('/', async (req, res) => {
  const { buscar } = req.query;
  let query = supabase
    .from('catalogo_productos')
    .select('codigo_catalogo, codigo_dc, codigo_alterno, mult_caja, mult_bolsa, mult_insert, mult_on_pack, mult_tbox, mult_opbox, pre_esteril_3_anios')
    .order('codigo_catalogo', { ascending: true })
    .limit(50);

  if (buscar) {
    query = query.or(`codigo_catalogo.ilike.%${buscar}%,codigo_dc.ilike.%${buscar}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/catalogo/:codigo — detalle de un código específico (por codigo_catalogo)
router.get('/:codigo', async (req, res) => {
  const { data, error } = await supabase
    .from('catalogo_productos')
    .select('*')
    .eq('codigo_catalogo', req.params.codigo)
    .single();

  if (error) return res.status(404).json({ error: 'Código no encontrado en el catálogo' });
  res.json(data);
});

module.exports = router;
