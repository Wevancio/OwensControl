# Lean Labels — Backend de Demostración (Node.js + Supabase/PostgreSQL)

Demo funcional del backend para el sistema de requisiciones de etiquetas.
Reemplaza el almacenamiento `window.storage` del demo anterior por una base
de datos PostgreSQL real con garantías de no-duplicado a nivel de motor.

## 1. Crear el proyecto en Supabase
1. Crea una cuenta/proyecto en https://supabase.com (tiene plan gratuito).
2. En el **SQL Editor** de tu proyecto, pega y ejecuta el contenido completo
   de `database/schema.sql`.
3. Después ejecuta `database/seed_areas.sql` para cargar el mapeo de áreas.
4. Después ejecuta `database/seed_catalogo.sql` para cargar los 1,492
   códigos reales del catálogo (puede tardar unos segundos por el tamaño).
5. En **Project Settings → API**, copia:
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

## 4. Estado de la lógica de negocio
La fórmula del número de lote y el catálogo de 1,492 códigos ya están
verificados contra el archivo original y contra el ejemplo real impreso
en FORM-21920. Ver `CLAUDE.md` para el detalle de la verificación y la
bitácora de correcciones. Pendientes reales: frontend, interfaz de Admin,
autenticación, y fijar `TZ=America/Hermosillo` en el backend al desplegar.

## Endpoints disponibles
| Método | Ruta                              | Descripción                                |
|--------|-----------------------------------|---------------------------------------------|
| GET    | `/api/health`                     | Estado del servicio                          |
| GET    | `/api/areas`                      | Lista de áreas activas                       |
| GET    | `/api/catalogo?buscar=70220861`   | Búsqueda en catálogo                         |
| GET    | `/api/catalogo/:codigo`           | Detalle de un código (por codigo_catalogo)   |
| GET    | `/api/requisiciones`              | Lista (filtros: `area_id`, `estado`, `fecha_produccion`) |
| POST   | `/api/requisiciones`              | Crear requisición (genera lote atómicamente) |
| PATCH  | `/api/requisiciones/:id/estado`   | Cambiar estado (valida transición permitida) |

## Estructura
```
OwensControl/
├── CLAUDE.md              # bitácora de decisiones, validaciones y pendientes
├── README.md
├── database/
│   ├── schema.sql         # esquema completo, validado con pruebas de concurrencia real
│   ├── seed_areas.sql
│   └── seed_catalogo.sql  # 1,492 códigos reales
└── backend/
    ├── package.json
    ├── .env.example
    └── src/
        ├── server.js
        ├── supabaseClient.js
        ├── loteLogic.js    # formula del lote verificada contra FORM-21920
        └── routes/
            ├── areas.js
            ├── catalogo.js
            └── requisiciones.js
```
