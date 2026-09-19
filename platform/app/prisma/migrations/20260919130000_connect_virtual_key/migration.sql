-- Connected self-hosted (ADR-139): a license resolves to a managed gateway key.
--
-- Additive only: a new enum value and one nullable column with a unique index.
-- The column stays NULL on every self-hosted install, where the registry table
-- is empty. No foreign key: the schema runs with relationMode = "prisma".

ALTER TYPE "VirtualKeyPurpose" ADD VALUE IF NOT EXISTS 'CONNECT';

ALTER TABLE "IssuedLicense" ADD COLUMN "virtualKeyId" TEXT;

CREATE UNIQUE INDEX "IssuedLicense_virtualKeyId_key" ON "IssuedLicense"("virtualKeyId");
