-- ADR-032 (D5): capture the original upload filename on the Dataset row at
-- presign time so the async normalize job can detect the file format
-- (CSV/JSONL/JSON) — the staged object itself carries no original name.
-- Additive only: new nullable column so existing rows stay valid.

-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN "uploadFilename" TEXT;
