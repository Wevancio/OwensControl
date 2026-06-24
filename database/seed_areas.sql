-- ============================================================================
-- Seed: Áreas confirmadas contra sheet "Letrasudi" del Excel real
-- Tiromat 1 NO existe — confirmado, no es un error de captura.
-- ============================================================================
INSERT INTO areas (nombre, letra, tipo_impresora) VALUES
    ('Doboy A',       'A', 'Zebra ZT601'),
    ('Doboy B',       'B', 'Zebra ZT601'),
    ('Tiromat 3',     'C', 'Zebra ZT601'),
    ('Tiromat 4',     'D', 'Zebra ZT601'),
    ('Multivac 1',    'E', 'Zebra ZT601'),
    ('Multivac 2',    'F', 'Zebra ZT601'),
    ('Tiromat 2',     'G', 'Zebra ZT601'),
    ('Thermal Doboy', 'T', 'Zebra ZT601')
ON CONFLICT (nombre) DO NOTHING;
