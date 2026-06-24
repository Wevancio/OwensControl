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
-- PENDIENTE: poblar con los 1,492 códigos reales desde ExcelRequisiciones.xlsx
-- (sheet "Ref. de Codigo terminado"). Por ahora solo la estructura, validada
-- contra las reglas de negocio confirmadas en sesiones anteriores.
CREATE TABLE IF NOT EXISTS catalogo_productos (
    codigo_dc                   TEXT PRIMARY KEY,
    codigo_alterno               TEXT,        -- valor directo de catálogo, NO derivado matemáticamente
    descripcion                  TEXT,
    etiquetas_caja_multiplicador SMALLINT NOT NULL DEFAULT 2 CHECK (etiquetas_caja_multiplicador IN (1,2)),
    pre_esteril_3_anios          BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE para los códigos con +3 años en vez de +5
    actualizado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN catalogo_productos.pre_esteril_3_anios IS
  'TRUE solo para los códigos Pre-Estéril confirmados con regla de expiración a 3 años. PENDIENTE: confirmar lista completa contra el archivo original (WI-29566 6.8.2.1 menciona 3 códigos: 77885, 44642, 88227 — verificar si el catálogo real tiene más).';

-- ----------------------------------------------------------------------------
-- 3. CONTADOR ATÓMICO DE SECUENCIA DE LOTE (pieza anti-duplicado)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lote_contadores (
    area_id           INTEGER NOT NULL REFERENCES areas(id),
    fecha_produccion  DATE NOT NULL,
    ultima_secuencia  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (area_id, fecha_produccion)
);

-- Función atómica: entrega la siguiente secuencia para un área+fecha.
-- Es seguro llamarla desde múltiples requisiciones simultáneas: Postgres
-- serializa internamente el INSERT ... ON CONFLICT a nivel de fila.
CREATE OR REPLACE FUNCTION siguiente_secuencia_lote(p_area_id INTEGER, p_fecha DATE)
RETURNS INTEGER AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    INSERT INTO lote_contadores (area_id, fecha_produccion, ultima_secuencia)
    VALUES (p_area_id, p_fecha, 1)
    ON CONFLICT (area_id, fecha_produccion)
    DO UPDATE SET ultima_secuencia = lote_contadores.ultima_secuencia + 1
    RETURNING ultima_secuencia INTO v_seq;
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
    codigo_dc            TEXT NOT NULL REFERENCES catalogo_productos(codigo_dc),
    cantidad             INTEGER NOT NULL CHECK (cantidad > 0),
    fecha_produccion     DATE NOT NULL,
    area_id              INTEGER NOT NULL REFERENCES areas(id),
    secuencia            INTEGER NOT NULL,
    numero_lote          TEXT NOT NULL UNIQUE,   -- <<< constraint real anti-duplicado
    fecha_manufactura    DATE,
    fecha_expiracion     DATE,
    on_pack_numero       TEXT,
    etiquetas_caja       INTEGER,
    dfu_manual           TEXT,
    solicitante          TEXT NOT NULL,
    notas                TEXT,
    estado               TEXT NOT NULL DEFAULT 'pendiente'
                          CHECK (estado IN ('pendiente','en_impresion','lista','rechazada','cancelada')),
    creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Redundancia defensiva: ni siquiera la combinación área+fecha+secuencia
    -- se puede repetir, independientemente del string de numero_lote.
    UNIQUE (area_id, fecha_produccion, secuencia)
);

CREATE INDEX IF NOT EXISTS idx_requisiciones_area_fecha ON requisiciones (area_id, fecha_produccion);
CREATE INDEX IF NOT EXISTS idx_requisiciones_estado ON requisiciones (estado);
CREATE INDEX IF NOT EXISTS idx_requisiciones_codigo ON requisiciones (codigo_dc);

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
