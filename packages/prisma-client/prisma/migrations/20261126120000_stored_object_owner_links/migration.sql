-- IRREVERSIBLE: creates the "StoredObjectOwner" table.
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- Content-addressed reuse and owner-linked retention:
-- modules/stored-object/adrs/002-content-addressed-reuse-and-owner-retention.md
CREATE TABLE IF NOT EXISTS "StoredObjectOwner" (
    "tenantId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "ownerKind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "retainUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredObjectOwner_pkey" PRIMARY KEY ("tenantId", "objectId", "ownerKind", "ownerId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StoredObjectOwner_retainUntil_idx" ON "StoredObjectOwner"("retainUntil");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StoredObjectOwner_tenantId_objectId_idx" ON "StoredObjectOwner"("tenantId", "objectId");

-- Backs StoredObjectRecordRepository.findReusable: an available object of one
-- project, purpose and SHA-256. "StoredObject" already exists, so the plain build
-- takes a SHARE lock and blocks writes to it while it runs. An install with real
-- traffic builds it ahead, outside Prisma's transaction, and this statement then
-- finds it built:
-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "StoredObject_tenantId_purpose_sha256_idx" ON "StoredObject" ("tenantId", "purpose", "sha256");
-- A failed CONCURRENTLY build leaves an invalid index under this name that IF NOT
-- EXISTS then skips. Check
--   SELECT indisvalid FROM pg_index WHERE indexrelid = '"StoredObject_tenantId_purpose_sha256_idx"'::regclass;
-- and DROP INDEX CONCURRENTLY IF EXISTS "StoredObject_tenantId_purpose_sha256_idx" before retrying.
CREATE INDEX IF NOT EXISTS "StoredObject_tenantId_purpose_sha256_idx"
  ON "StoredObject" ("tenantId", "purpose", "sha256");

-- Down (manual rollback; uncomment and run). The indexes hold no row data of
-- their own; outside Prisma's transaction, DROP INDEX CONCURRENTLY does not block:
-- DROP INDEX CONCURRENTLY IF EXISTS "StoredObject_tenantId_purpose_sha256_idx";
