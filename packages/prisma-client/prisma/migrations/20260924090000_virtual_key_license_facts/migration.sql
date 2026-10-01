-- The license a CONNECT key serves, as gateway facts licensing writes (ADR-156).
-- Additive and nullable: the image still serving never names these columns.
ALTER TABLE "VirtualKey" ADD COLUMN "licenseTokenHash" TEXT;
ALTER TABLE "VirtualKey" ADD COLUMN "licenseInstanceId" TEXT;
ALTER TABLE "VirtualKey" ADD COLUMN "licenseExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "VirtualKey_licenseTokenHash_key" ON "VirtualKey"("licenseTokenHash");
