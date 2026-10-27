-- The license a CONNECT key serves, as gateway facts licensing writes (ADR-156).
-- Additive and nullable: the image still serving never names these columns.
-- One ALTER per table per migration, so each takes its lock alone: the instance
-- and expiry columns follow in 20261006170519 and 20261006170520.
ALTER TABLE "VirtualKey" ADD COLUMN IF NOT EXISTS "licenseTokenHash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "VirtualKey_licenseTokenHash_key" ON "VirtualKey"("licenseTokenHash");
