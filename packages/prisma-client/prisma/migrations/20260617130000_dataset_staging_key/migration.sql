-- ADR-032 (C1): bind the direct-upload staging key to the Dataset row.
-- Finalize reads `stagingKey` from the row instead of trusting a client param.
-- Additive only: new nullable column so existing rows stay valid.

-- AlterTable
ALTER TABLE "Dataset" ADD COLUMN "stagingKey" TEXT;
