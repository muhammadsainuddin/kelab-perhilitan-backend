-- ============================================================
-- Migrasi: Tambah kod_majikan ke jadual users
-- Digunakan untuk ahli Potongan Biro Angkasa
-- ============================================================

ALTER TABLE users
    ADD COLUMN kod_majikan VARCHAR(50) NULL
        COMMENT 'Kod majikan Biro Angkasa (ditetapkan oleh JPA/agensi)'
    AFTER jenis_potongan;
