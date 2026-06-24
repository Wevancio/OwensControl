const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// GET /api/areas — lista todas las áreas activas (para llenar selects en el frontend)
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('areas')
    .select('id, nombre, letra, tipo_impresora, activo')
    .eq('activo', true)
    .order('letra', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

module.exports = router;
