# Lean Labels — Backend de Demostración (Node.js + Supabase/PostgreSQL)

Demo funcional del backend para el sistema de requisiciones de etiquetas.
Reemplaza el almacenamiento `window.storage` del demo anterior por una base
de datos PostgreSQL real con garantías de no-duplicado a nivel de motor.

## 1. Crear el proyecto en Supabase
1. Crea una cuenta/proyecto en https://supabase.com (tiene plan gratuito).
2. En el **SQL Editor** de tu proyecto, pega y ejecuta el contenido completo
   de `database/schema.sql`.
3. Después ejecuta `database/seed_areas.sql` para cargar el mapeo de áreas.
4. En **Project Settings → API**, copia:
   - `Project URL` → va en `SUPABASE_URL`
   - `service_role` key (no la `anon` key) → va en `SUPABASE_SERVICE_ROLE_KEY`

## 2. Configurar el backend
```bash
cd backend
cp .env.example .env
# edita .env y pega tus valores reales de Supabase
npm install
npm start
```
El servidor queda en `http://localhost:3001`.

## 3. Probar que funciona
```bash
curl http://localhost:3001/api/health
curl http://localhost:3001/api/areas
```

## 4. Antes de usar con datos reales — leer CLAUDE.md
Hay dos pendientes críticos documentados en `CLAUDE.md`:
1. El cálculo exacto del número de lote (`construirNumeroLote` en
   `backend/src/loteLogic.js`) es un placeholder — falta verificar contra
   el archivo original.
2. El catálogo de productos está vacío de datos reales (1,492 códigos
   pendientes de importar desde el Excel).

## Endpoints disponibles
| Método | Ruta                              | Descripción                                |
|--------|-----------------------------------|---------------------------------------------|
| GET    | `/api/health`                     | Estado del servicio                          |
| GET    | `/api/areas`                      | Lista de áreas activas                       |
| GET    | `/api/catalogo?buscar=88183`      | Búsqueda en catálogo                         |
| GET    | `/api/catalogo/:codigo`           | Detalle de un código                         |
| GET    | `/api/requisiciones`              | Lista (filtros: `area_id`, `estado`, `fecha_produccion`) |
| POST   | `/api/requisiciones`              | Crear requisición (genera lote atómicamente) |
| PATCH  | `/api/requisiciones/:id/estado`   | Cambiar estado (valida transición permitida) |

## Estructura
```
lean-labels-db/
├── CLAUDE.md              # bitácora de decisiones, validaciones y pendientes
├── README.md
├── .env.example
├── database/
│   ├── schema.sql         # esquema completo, validado con pruebas de concurrencia real
│   └── seed_areas.sql
└── backend/
    ├── package.json
    └── src/
        ├── server.js
        ├── supabaseClient.js
        ├── loteLogic.js
        └── routes/
            ├── areas.js
            ├── catalogo.js
            └── requisiciones.js
```
