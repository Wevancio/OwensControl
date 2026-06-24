const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[FATAL] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el archivo .env. ' +
    'Copia .env.example a .env y llena los valores de tu proyecto Supabase.'
  );
  process.exit(1);
}

// IMPORTANTE: la service_role key tiene permisos totales y NUNCA debe
// exponerse al frontend. Solo vive aquí, en el backend.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = supabase;
