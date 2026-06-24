-- ============================================================================
-- Lean Labels — Esquema de Base de Datos (PostgreSQL / Supabase)
-- ============================================================================
-- Ejecutar este archivo completo en el SQL Editor de Supabase (o vía psql)
-- antes de levantar el backend.
--
-- DECISIÓN CLAVE DE DISEÑO (responde al requisito de control de duplicados):
--   El número de lote tiene un constraint UNIQUE a nivel de motor de base de
--   datos (no solo lógica de aplicación). Adicionalmente, la secuencia diaria
--   por área se genera con una función atómica (siguiente_secuencia_lote)
--   que usa INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING, la cual es
--   una sola operación atómica en Postgres: dos requisiciones simultáneas
--   para la misma área y fecha JAMÁS pueden recibir la misma secuencia,
--   sin importar qué tan rápido lleguen las solicitudes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ÁREAS / LÍNEAS DE PRODUCCIÓN
-- ----------------------------------------------------------------------------
-- Mapeo confirmado contra el Excel real (sheet "Letrasudi"). Tiromat 1 no existe.
CREATE TABLE IF NOT EXISTS areas (
    id              SERIAL PRIMARY KEY,
    nombre          TEXT UNIQUE NOT NULL,   -- 'Doboy A', 'Multivac 1', etc.
    letra           TEXT UNIQUE NOT NULL,   -- 'A','B','C','D','E','F','G','T'
    tipo_impresora  TEXT DEFAULT 'Zebra ZT601',
    activo          BOOLEAN NOT NULL DEFAULT TRUE
);

-- ----------------------------------------------------------------------------
-- 2. CATÁLOGO DE PRODUCTOS
-- ----------------------------------------------------------------------------
-- VALIDADO contra ExcelRequisiciones.xlsx, hoja "Ref. de Codigo terminado"
-- (1,492 códigos únicos; 1,493 filas en el Excel por un duplicado de llave
-- ya resuelto tomando el último valor, igual que en el catálogo embebido
-- del demo HTML). Mapeo de columnas confirmado celda por celda:
--   Col A "Codigo Pre Steril"        -> codigo_catalogo (llave real de búsqueda)
--   Col B "Codigo Post Steril"       -> codigo_dc
--   Col C "Codigo Producto Terminado"-> codigo_alterno
--   Col D..I "Etiquetas de Caja/Bolsa/Insert/On-Pack/Thermal Box/On Pack Box"
--                                    -> mult_caja, mult_bolsa, mult_insert, mult_on_pack, mult_tbox, mult_opbox
--   Col J "Descripcion Etiquetas"    -> sap_codes (en realidad son códigos SAP, no descripción)
CREATE TABLE IF NOT EXISTS catalogo_productos (
    codigo_catalogo     TEXT PRIMARY KEY,   -- "Codigo Pre Steril" - llave real de búsqueda y de SHORT_EXP_CODES
    codigo_dc           TEXT NOT NULL,      -- "Codigo Post Steril" - usado para On Pack # (primeros 5 caracteres)
    codigo_alterno      TEXT,               -- "Codigo Producto Terminado" - valor directo de catálogo, NO derivado
    mult_caja           INTEGER NOT NULL DEFAULT 0,
    mult_bolsa          INTEGER NOT NULL DEFAULT 0,
    mult_insert         INTEGER NOT NULL DEFAULT 0,
    mult_on_pack        INTEGER NOT NULL DEFAULT 0,
    mult_tbox           INTEGER NOT NULL DEFAULT 0,
    mult_opbox          INTEGER NOT NULL DEFAULT 0,
    sap_codes           TEXT,
    pre_esteril_3_anios BOOLEAN NOT NULL DEFAULT FALSE,
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN catalogo_productos.pre_esteril_3_anios IS
  'TRUE solo para los 5 codigo_catalogo confirmados con regla de expiracion a 3 anios: 70219294, 70219058, 70219315, 70216181, 70202685 (variantes -00/-01/-04/-05/-80 de los 3 codigos base 77885/44642/88227 mencionados en WI-29566 6.8.2.1; la lista de 5 viene del catalogo real, no del WI).';

-- ----------------------------------------------------------------------------
-- 3. CONTADOR ATÓMICO DE SECUENCIA DE LOTE (pieza anti-duplicado)
-- ----------------------------------------------------------------------------
-- CORREGIDO (ver CLAUDE.md, bitácora de errores): la llave real NO es
-- (area, fecha_produccion). La fórmula real es:
--   "AC" & AÑO(HOY(), 2 dígitos) & díaDelAño(FechaProduccion) & secuencia & letraDeArea
-- El año viene de HOY (fecha de captura), NO del año de fecha_produccion.
-- Esto significa que dos Fechas de Producción de AÑOS DISTINTOS pero con el
-- mismo día-del-año, capturadas el mismo día real, comparten el mismo
-- prefijo y por lo tanto el mismo pool de secuencia. La llave del contador
-- debe reflejar exactamente eso.
CREATE TABLE IF NOT EXISTS lote_contadores (
    area_id           INTEGER NOT NULL REFERENCES areas(id),
    anio_2d            TEXT NOT NULL,   -- año actual (HOY), 2 dígitos, ej. '26'
    dia_juliano        TEXT NOT NULL,   -- día del año de Fecha de Producción, 3 dígitos, ej. '173'
    ultima_secuencia   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (area_id, anio_2d, dia_juliano)
);

-- Función atómica: entrega la siguiente secuencia (1-99, igual que el demo
-- original que reserva el primer hueco libre 1..99). Lanza excepción si se
-- agota, igual que el mensaje "Secuencia diaria agotada" del demo.
CREATE OR REPLACE FUNCTION siguiente_secuencia_lote(p_area_id INTEGER, p_anio_2d TEXT, p_dia_juliano TEXT)
RETURNS INTEGER AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    INSERT INTO lote_contadores (area_id, anio_2d, dia_juliano, ultima_secuencia)
    VALUES (p_area_id, p_anio_2d, p_dia_juliano, 1)
    ON CONFLICT (area_id, anio_2d, dia_juliano)
    DO UPDATE SET ultima_secuencia = lote_contadores.ultima_secuencia + 1
    RETURNING ultima_secuencia INTO v_seq;

    IF v_seq > 99 THEN
        RAISE EXCEPTION 'Secuencia diaria agotada (>99) para area_id=%, anio=%, dia=%', p_area_id, p_anio_2d, p_dia_juliano;
    END IF;

    RETURN v_seq;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 4. REQUISICIONES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS requisiciones (
    id                  BIGSERIAL PRIMARY KEY,
    semana              TEXT,
    orden                TEXT NOT NULL,
    orden_particionada   TEXT,
    codigo_catalogo      TEXT NOT NULL REFERENCES catalogo_productos(codigo_catalogo),
    cantidad             INTEGER NOT NULL CHECK (cantidad > 0),
    fecha_produccion     DATE NOT NULL,
    area_id              INTEGER NOT NULL REFERENCES areas(id),
    anio_2d              TEXT NOT NULL,
    dia_juliano          TEXT NOT NULL,
    secuencia            INTEGER NOT NULL,
    numero_lote          TEXT NOT NULL UNIQUE,   -- <<< constraint real anti-duplicado
    fecha_manufactura    DATE,
    fecha_expiracion     DATE,
    on_pack_numero       TEXT,
    cantidad_caja        INTEGER NOT NULL DEFAULT 0,
    cantidad_bolsa       INTEGER NOT NULL DEFAULT 0,
    cantidad_insert      INTEGER NOT NULL DEFAULT 0,
    cantidad_on_pack     INTEGER NOT NULL DEFAULT 0,
    cantidad_tbox        INTEGER NOT NULL DEFAULT 0,
    cantidad_opbox       INTEGER NOT NULL DEFAULT 0,
    dfu_manual           INTEGER NOT NULL DEFAULT 0,
    solicitante          TEXT NOT NULL,
    notas                TEXT,
    estado               TEXT NOT NULL DEFAULT 'pendiente'
                          CHECK (estado IN ('pendiente','en_impresion','lista','rechazada','cancelada')),
    creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Defensa adicional: la funcion siguiente_secuencia_lote() ya limita a
    -- 1-99, pero un INSERT directo a la tabla (sin pasar por la funcion) no
    -- estaria protegido sin este CHECK.
    CHECK (secuencia BETWEEN 1 AND 99),

    -- Redundancia defensiva: ni siquiera la combinación área+año+día+secuencia
    -- se puede repetir, independientemente del string de numero_lote.
    UNIQUE (area_id, anio_2d, dia_juliano, secuencia)
);

CREATE INDEX IF NOT EXISTS idx_requisiciones_area_fecha ON requisiciones (area_id, fecha_produccion);
CREATE INDEX IF NOT EXISTS idx_requisiciones_estado ON requisiciones (estado);
CREATE INDEX IF NOT EXISTS idx_requisiciones_codigo ON requisiciones (codigo_catalogo);

-- Trigger simple para mantener actualizado_en
CREATE OR REPLACE FUNCTION set_actualizado_en()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_en = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_requisiciones_actualizado ON requisiciones;
CREATE TRIGGER trg_requisiciones_actualizado
    BEFORE UPDATE ON requisiciones
    FOR EACH ROW
    EXECUTE FUNCTION set_actualizado_en();

-- ----------------------------------------------------------------------------
-- 5. AUDITORÍA
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
    id               BIGSERIAL PRIMARY KEY,
    requisicion_id   BIGINT REFERENCES requisiciones(id),
    usuario          TEXT,
    accion           TEXT NOT NULL,   -- 'creada','aceptada','rechazada','cancelada','marcada_lista', etc.
    detalle          JSONB,
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_requisicion ON auditoria (requisicion_id);
