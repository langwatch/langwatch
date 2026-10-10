-- The platform model services a licence's managed key may serve (ADR-156).
-- Additive with a default: the image still serving never names this column.
ALTER TABLE "VirtualKey" ADD COLUMN "connectServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
