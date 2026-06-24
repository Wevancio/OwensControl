# CLAUDE.md — Lean Labels: Migración a Base de Datos Real

## Resumen del proyecto
Sistema de control de requisiciones de etiquetas para Owens & Minor, planta
Nogales (WI-29566, FORM-21920, PR-09646). Evolucionando de un demo en un solo
archivo HTML (con `window.storage` como almacenamiento) a una arquitectura
con base de datos real, por el requisito explícito de que el **NÚMERO DE
LOTE nunca debe repetirse** — una garantía que `window.storage` no podía
dar a nivel de motor de datos.

## Decisiones de arquitectura (confirmadas con el usuario)
- **Backend**: Node.js + Express — alcance de **demo funcional para exponer**.
- **Base de datos**: PostgreSQL, hospedado en **Supabase**.
- **Interfaces**: una sola aplicación con selector de rol al entrar
  (Solicitante / Almacén-Etiquetado / Admin), todas compartiendo los mismos
  datos en tiempo real vía la API del backend.
- **Repositorio**: `https://github.com/Wevancio/OwensControl` (público).

## ✅ ESTADO ACTUAL: lógica de negocio verificada contra el archivo original
El archivo `lean-labels-requisiciones-demo.html` y `ExcelRequisiciones.xlsx`
fueron subidos y revisados línea por línea / celda por celda. Ya NO hay
lógica placeholder en `loteLogic.js` — todo está verificado contra el
ejemplo real impreso en FORM-21920 (`Lot # = AC2617303A`, Fecha de
Manufactura `2026-06-22`) y contra una prueba automatizada que reproduce
ese resultado exacto.

## Fórmula real del número de lote (verificada, no placeholder)
```
numero_lote = "AC" + AÑO_DE_HOY(2 dígitos) + DÍA_DEL_AÑO(Fecha de Producción, 3 dígitos)
              + SECUENCIA(2 dígitos) + LETRA_DE_ÁREA
```
Puntos clave que NO eran obvios y que se confirmaron contra el código real:
- `PLANT_CODE` es la constante literal `"AC"` — NO es una letra de área
  (mi primera hipótesis estaba mal: pensé que "AC" venía de combinar dos
  letras de área).
- El año usado es el **año de HOY** (fecha de captura del lote), **NO** el
  año de la Fecha de Producción capturada en el formulario.
- El día del año sí viene de la Fecha de Producción capturada.
- La letra de área va **al final** del string, después de la secuencia
  (no al principio como yo había asumido inicialmente).
- Consecuencia importante para la base de datos: la llave real que
  determina si dos lotes pueden colisionar es
  **(área, año-de-hoy, día-del-año-de-producción)**, NO (área,
  fecha_producción) como diseñé en la primera versión del esquema. Dos
  Fechas de Producción de años distintos pero mismo día-del-año, capturadas
  el mismo día real, comparten el mismo pool de secuencia.

## Catálogo de productos: estructura real (verificada)
El catálogo NO tiene un solo multiplicador "etiquetas de caja x1 o x2"
como asumí inicialmente — tiene **6 multiplicadores independientes** por
tipo de etiqueta: caja, bolsa, insert, on_pack, tbox (thermal box), opbox
(on pack box). Verificado contra `ExcelRequisiciones.xlsx`, hoja "Ref. de
Codigo terminado", mapeo de columnas confirmado celda por celda:
- Col A "Codigo Pre Steril" → `codigo_catalogo` (llave real de búsqueda y
  de la lista de códigos con expiración a 3 años)
- Col B "Codigo Post Steril" → `codigo_dc` (usado para On Pack #)
- Col C "Codigo Producto Terminado" → `codigo_alterno`
- Col D-I → `mult_caja, mult_bolsa, mult_insert, mult_on_pack, mult_tbox, mult_opbox`
- Col J "Descripcion Etiquetas" → en realidad son códigos SAP, no descripción

**1,492 códigos reales importados** (`database/seed_catalogo.sql`),
extraídos del catálogo embebido en el HTML y verificados contra el Excel:
conteo exacto coincide, los 5 códigos Pre-Estéril coinciden exactamente.
El Excel tiene 1,493 filas pero 1,492 claves únicas (un duplicado de
`codigo_catalogo`); el catálogo del HTML ya resolvió esto tomando el
último valor — mismo comportamiento esperado en JS con claves de objeto
duplicadas.

## Discrepancia resuelta: códigos Pre-Estéril (3 años de expiración)
El WI-29566 §6.8.2.1 menciona 3 códigos base (77885, 44642, 88227) con
SPEC de 3 años. El catálogo real tiene 5 entradas (`codigo_catalogo`):
70219294, 70219058, 70219315, 70216181, 70202685 — son variantes
específicas (-00/-01/-04/-05/-80) de esos mismos 3 códigos DC base. No es
una contradicción: el WI describe los códigos DC, el catálogo real
distingue por variante de Código Pre-Estéril. Ambas fuentes son
consistentes una vez identificado el nivel de detalle correcto.

## On Pack #: corrección menor
No es simplemente "primeros 5 caracteres del Código DC" sin condición —
si la cantidad de On Pack calculada (cantidad pedida × mult_on_pack) es 0,
el valor real es **"N/A"**, no los 5 caracteres. Corregido en
`deriveOnPack()`.

## Validaciones probadas con Postgres real en esta sesión
1. **50 llamadas concurrentes** a `siguiente_secuencia_lote()` (llave
   corregida área+año+día) → secuencias 1-50, sin duplicados ni huecos.
2. **Reproducción exacta del ejemplo real de FORM-21920**: con "hoy" =
   2026-06-22, área Doboy A, secuencia 3 → `AC2617303A`. MATCH exacto con
   el formulario real (verificado con prueba automatizada en Node).
3. **Inserción real completa** del caso FORM-21920 (código 70216188,
   cantidad, fechas, on_pack_numero) → exitosa.
4. **Duplicado de `numero_lote`** → rechazado por el motor.
5. **Duplicado de (área, año, día, secuencia)** con `numero_lote` distinto
   → rechazado por el motor (doble candado).
6. **Estado fuera de catálogo** y **cantidad ≤ 0** → rechazados por CHECK.
7. **1,492 filas del catálogo real** importadas sin error; conteo y casos
   puntuales (Pre-Estéril, ejemplo FORM-21920) verificados.
8. Backend Node: los 6 módulos cargan sin error de sintaxis; servidor
   arranca y `/api/health` responde 200.

## Backend (backend/)
- `src/loteLogic.js` — lógica de negocio verificada (ver arriba), incluye
  prueba inline reproducible contra el ejemplo real de FORM-21920.
- `src/routes/requisiciones.js` — POST con secuencia atómica usando la
  llave corregida (área, año-de-hoy, día-juliano), inserta las 6
  cantidades reales por tipo de etiqueta, maneja error 23505 como defensa
  en capas. PATCH de estado con máquina de transiciones válidas.
- `src/routes/catalogo.js` — búsqueda por `codigo_catalogo` (la llave real).

## Pendientes
1. Construir el frontend (single-page, selector de rol) que consuma esta
   API en vez de `window.storage`. Reusar UI/lógica de barcode (JsBarcode)
   y PDF (html2canvas + jsPDF) del demo original.
2. Construir la interfaz de Admin (gestión de catálogo, reportes/consultas,
   bitácora de auditoría, configuración de áreas).
3. Definir autenticación real (Supabase Auth) — el demo original usaba
   "escanear credencial" como firma electrónica; decidir si se mantiene
   ese flujo o se reemplaza por login real.
4. **Zona horaria del servidor**: la fórmula usa `new Date().getFullYear()`
   (hora local del proceso Node). Para que el año-de-hoy coincida siempre
   con la hora de planta, fijar `TZ=America/Hermosillo` (Sonora, sin
   horario de verano) como variable de entorno del backend al desplegar.
5. Conectar el proyecto Supabase real (crear proyecto, correr schema.sql +
   seed_areas.sql + seed_catalogo.sql, llenar `.env`).

## Bitácora de errores (corregidos en esta sesión, antes de llegar a producción)
1. **Error**: asumí que la secuencia de lote se contaba por (área, fecha de
   producción). **Real**: se cuenta por (área, año de HOY, día-del-año de
   la fecha de producción). **Causa**: no tenía el archivo original en la
   sesión anterior y construí un esquema razonable pero no verificado.
   **Corrección**: esquema y función atómica reconstruidos con la llave
   correcta; revalidado con 50 llamadas concurrentes.
2. **Error**: asumí `PLANT_CODE` derivado de la letra de área. **Real**: es
   la constante literal `"AC"`, independiente del área; la letra de área
   va al final del string, no al principio. **Corrección**: `loteLogic.js`
   reescrito y verificado contra el ejemplo real de FORM-21920.
3. **Error**: modelé el catálogo con un solo multiplicador "etiquetas de
   caja x1/x2". **Real**: 6 multiplicadores independientes por tipo de
   etiqueta (caja, bolsa, insert, on_pack, tbox, opbox). **Corrección**:
   esquema y rutas actualizados; catálogo real de 1,492 códigos importado
   y verificado contra el Excel.
4. **Error**: `deriveOnPack()` devolvía siempre los primeros 5 caracteres
   del Código DC. **Real**: devuelve "N/A" si la cantidad de On Pack
   calculada es 0. **Corrección**: aplicada y probada.
5. **Encontrado en revisión de esquema con el usuario** (no era un error de
   lógica de negocio, sino de tipado/validación): `dfu_manual` estaba como
   `TEXT` en vez de `INTEGER` — permitía guardar texto no numérico que
   reventaría cálculos después. **Corrección**: columna a `INTEGER NOT NULL
   DEFAULT 0`; la ruta ahora hace `parseInt()` antes de insertar. También se
   agregó `CHECK (secuencia BETWEEN 1 AND 99)` a nivel de tabla como defensa
   adicional, por si algún día se inserta directo sin pasar por la función
   atómica. Probado con Postgres real: secuencia 0 y 100 rechazadas,
   `dfu_manual='abc'` rechazado por el motor, inserción válida con
   `dfu_manual=7` aceptada correctamente. También se limpió un comentario
   viejo y contradictorio en `catalogo_productos` que quedó de una edición
   anterior (decía "PENDIENTE" justo arriba de "VALIDADO").
