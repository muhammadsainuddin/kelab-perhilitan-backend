-- ============================================================
-- Migrasi: Sistem Resit Berasingan
--   - Jadual resit_biro_angkasa (potongan Biro Angkasa)
--   - Tambah no_resit ke sejarah_bayaran (bayaran manual/FPX)
-- No. Resit:
--   Biro Angkasa : BA-YYYYMM-NNNNN  (cth: BA-202606-00001)
--   Manual / FPX : YR-YYYYMM-NNNNN  (cth: YR-202606-00001)
-- ============================================================

-- LANGKAH 1: Jadual resit Biro Angkasa
CREATE TABLE IF NOT EXISTS resit_biro_angkasa (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    no_resit        VARCHAR(20)     NOT NULL UNIQUE
                    COMMENT 'Format: BA-YYYYMM-NNNNN',
    no_kp           VARCHAR(20)     NOT NULL,
    no_ahli         VARCHAR(20)     NULL,
    nama_pegawai    VARCHAR(255)    NOT NULL,
    amaun           DECIMAL(10,2)   NOT NULL,
    bulan_potongan  DATE            NOT NULL
                    COMMENT 'Hari pertama bulan potongan, e.g. 2026-01-01',
    tarikh_jana     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dijana_oleh     VARCHAR(20)     NOT NULL DEFAULT 'SISTEM'
                    COMMENT 'no_kp admin atau SISTEM',
    INDEX idx_no_kp (no_kp),
    INDEX idx_bulan (bulan_potongan),
    UNIQUE KEY uniq_ahli_bulan (no_kp, bulan_potongan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Resit potongan yuran melalui Biro Angkasa (berasingan dari FPX)';

-- LANGKAH 2: Tambah no_resit ke sejarah_bayaran (bayaran manual / FPX)
ALTER TABLE sejarah_bayaran
    ADD COLUMN no_resit VARCHAR(20) NULL UNIQUE
    COMMENT 'Format: YR-YYYYMM-NNNNN. NULL = belum berjaya atau belum diberikan resit.'
    AFTER billCode;
