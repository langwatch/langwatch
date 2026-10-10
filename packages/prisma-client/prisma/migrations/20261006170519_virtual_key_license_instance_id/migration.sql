-- The instance a CONNECT key's license names (ADR-156), split from
-- 20261006170507 so each migration alters VirtualKey once. Nullable: the image
-- still serving never names it.
ALTER TABLE "VirtualKey" ADD COLUMN IF NOT EXISTS "licenseInstanceId" TEXT;
