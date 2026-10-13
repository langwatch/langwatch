-- The licence a managed CONNECT key serves (C3b); gateway finds the key by it before minting one.
ALTER TABLE "VirtualKey" ADD COLUMN IF NOT EXISTS "licenseId" TEXT;
