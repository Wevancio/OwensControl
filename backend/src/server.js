require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, servicio: 'lean-labels-backend' }));

app.use('/api/areas', require('./routes/areas'));
app.use('/api/catalogo', require('./routes/catalogo'));
app.use('/api/requisiciones', require('./routes/requisiciones'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Lean Labels backend escuchando en http://localhost:${PORT}`);
});
