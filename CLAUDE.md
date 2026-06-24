# CLAUDE.md — Lean Labels: Migración a Base de Datos Real

## Resumen del proyecto
Sistema de control de requisiciones de etiquetas para Owens & Minor, planta
Nogales (WI-29566, FORM-21920, PR-09646). Evolucionando de un demo en un solo
archivo HTML (con `window.storage` como almacenamiento) a una arquitectura
con base de datos real, por el requisito explícito de que el **NÚMERO DE
LOTE nunca debe repetirse** — una garantía que `window.storage` no podía
dar a nivel de motor de datos.

## Decisiones de arquitectura (confirmadas con el usuario)
- **Backend**: Node.js + Express — alcance de **demo funcional para exponer**,
  no para producción todavía. Decisión de IT sobre infraestructura real
  queda pendiente para después.
- **Base de datos**: PostgreSQL, hospedado en **Supabase**.
- **Interfaces**: una sola aplicación con selector de rol al entrar
  (Solicitante / Almacén-Etiquetado / Admin), todas compartiendo los mismos
  datos en tiempo real vía la API del backend. NO se separan en archivos
  independientes (eso rompería la sincronización en tiempo real que ya
  funcionaba en el demo anterior).

## Por qué una base de datos real y no seguir en el artifact
`window.storage` (usado en el demo anterior) no tiene `UNIQUE` constraints
reales ni transacciones atómicas — la prevención de duplicados dependía
100% de lógica de aplicación bien ejecutada. PostgreSQL sí da esa garantía
a nivel de motor, independientemente de bugs de aplicación.

## Esquema de base de datos (database/schema.sql)
- `areas` — mapeo letra↔área, **confirmado** contra el Excel real (sheet
  "Letrasudi"): Doboy A=A, Doboy B=B, Tiromat 3=C, Tiromat 4=D, Multivac 1=E,
  Multivac 2=F, Tiromat 2=G, Thermal Doboy=T. Tiromat 1 NO existe (confirmado,
  no es error de captura).
- `catalogo_productos` — estructura lista, **datos reales pendientes** de
  importar desde `ExcelRequisiciones.xlsx` (1,492 códigos, sheet "Ref. de
  Codigo terminado").
- `lote_contadores` + función `siguiente_secuencia_lote()` — pieza central
  anti-duplicado. Usa `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`,
  atómico a nivel de fila en Postgres.
- `requisiciones` — `numero_lote UNIQUE` + `UNIQUE(area_id, fecha_produccion,
  secuencia)` como doble candado. `CHECK` en `estado` (5 estados del demo
  original) y en `cantidad > 0`.
- `auditoria` — registro de creación y cambios de estado.

## Validaciones probadas en esta sesión (con Postgres real, no simulado)
Se instaló Postgres en el sandbox, se corrió `schema.sql` completo sin
errores, y se ejecutaron pruebas reales:

1. **50 llamadas concurrentes** a `siguiente_secuencia_lote()` para la misma
   área+fecha → resultado: secuencias 1 a 50, sin un solo duplicado ni hueco.
2. **Insertar el mismo `numero_lote` dos veces** → segundo INSERT rechazado
   por el motor (`duplicate key value violates unique constraint`).
3. **Estado fuera del catálogo permitido** (`'estado_invalido'`) → rechazado
   por el `CHECK constraint`.
4. **`cantidad = 0`** → rechazado por el `CHECK constraint`.
5. **Misma combinación área+fecha+secuencia** con `numero_lote` distinto →
   rechazado por el `UNIQUE` compuesto (defensa adicional incluso si el
   string del lote tuviera un bug).

Conclusión: el mecanismo anti-duplicado **sí funciona de verdad**, no es
solo código que parece correcto — se demostró bajo carga concurrente real.

## Backend (backend/)
- `src/server.js` — Express, monta `/api/areas`, `/api/catalogo`,
  `/api/requisiciones`, `/api/health`.
- `src/supabaseClient.js` — cliente con `service_role` key (nunca se expone
  al frontend).
- `src/loteLogic.js` — reglas de negocio: expiración (Thermal Doboy +1 año,
  Pre-Estéril +3 años, resto +5 años), On Pack # (primeros 5 caracteres del
  Código DC), Etiquetas de Caja (catálogo × multiplicador).
- `src/routes/requisiciones.js` — POST con secuencia atómica + manejo de
  error `23505` (duplicado) como defensa en capas; PATCH de estado con
  máquina de transiciones válidas (`pendiente → en_impresion/rechazada/
  cancelada`, `en_impresion → lista/cancelada`, resto son finales).

Se validó (real, no asumido):
- `npm install` resuelve sin errores.
- Los 6 módulos cargan sin errores de sintaxis (probado con env vars
  ficticias para no depender de credenciales reales).
- El servidor arranca y `/api/health` responde `200 {ok:true}`.

## ⚠️ PENDIENTE CRÍTICO — no usar con datos reales todavía
**`construirNumeroLote()` en `backend/src/loteLogic.js` es un PLACEHOLDER.**

No se tiene acceso en esta sesión al archivo original
`lean-labels-requisiciones-demo.html` (el sandbox de Claude se reinicia
entre conversaciones y el usuario no pudo volver a subirlo). Lo que SÍ está
confirmado de sesiones anteriores:
- Usa el año actual (no necesariamente el año de `fecha_produccion`).
- Usa el día-del-año calculado desde la `Fecha de Producción` capturada
  (no desde la fecha de manufactura).
- Hay una fecha ancla interna ("Año: 2025-12-31", 31-dic del año anterior)
  para la aritmética de día-del-año.
- Incorpora letra de área + secuencia diaria por área.

Ejemplo real visto en FORM-21920 para validar después: `Lot # = AC2617303A`
con Fecha de Manufactura `2026-06-22` — el `173` coincide con el día del año
de esa fecha. El resto del patrón (por qué `AC` con dos letras si el mapeo
de áreas es de una sola letra, qué significa el sufijo final `A`, etc.) NO
se completó a ciegas — falta el archivo original para no introducir un bug
silencioso en el campo más sensible del sistema.

**Antes de usar este sistema con datos reales**, sustituir
`construirNumeroLote()` por el algoritmo exacto, validado contra el archivo
original y contra ejemplos reales como el de FORM-21920.

## Otros pendientes
1. Subir `lean-labels-requisiciones-demo.html` original → para extraer el
   algoritmo exacto del número de lote.
2. Subir `ExcelRequisiciones.xlsx` → para poblar `catalogo_productos` con
   los 1,492 códigos reales (en vez de los datos de prueba usados para
   validar el esquema).
3. Confirmar la lista completa de códigos con regla de expiración a 3 años
   (Pre-Estéril). El WI-29566 §6.8.2.1 menciona 3 códigos (77885, 44642,
   88227); la memoria de sesiones anteriores menciona "cinco códigos" — hay
   que verificar contra el archivo original cuál es el conteo correcto.
4. Construir el frontend (single-page, selector de rol) que consuma esta
   API en vez de `window.storage`. Reusar UI/lógica de barcode (JsBarcode)
   y PDF (html2canvas + jsPDF) del demo original una vez recuperado.
5. Construir la interfaz de Admin (gestión de catálogo, reportes/consultas,
   bitácora de auditoría, configuración de áreas).
6. Definir autenticación real (Supabase Auth) — el demo original usaba
   "escanear credencial" como firma electrónica; hay que decidir si se
   mantiene ese flujo o se reemplaza por login real.

## Bitácora de errores
*(vacía por ahora — se llenará cada vez que se cometa y corrija un error,
según instrucción del usuario)*
