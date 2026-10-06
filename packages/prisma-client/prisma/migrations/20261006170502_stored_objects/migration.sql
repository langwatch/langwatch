-- One Stored Objects operational table. The legacy ClickHouse table remains
-- authoritative until the system migration finalizes a tenant.
CREATE TABLE "StoredObject" (
    "tenantId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "ownerKind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "mediaTypeVerified" BOOLEAN NOT NULL DEFAULT false,
    "storageProvider" TEXT,
    "storageDestinationId" TEXT,
    "storageProviderRelativeId" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "audiences" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "legacyFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("tenantId", "id")
);

CREATE INDEX "StoredObject_tenantId_status_id_idx" ON "StoredObject"("tenantId", "status", "id");
CREATE INDEX "StoredObject_ownerKind_ownerId_status_idx" ON "StoredObject"("ownerKind", "ownerId", "status");
CREATE INDEX "StoredObject_status_expiresAt_idx" ON "StoredObject"("status", "expiresAt");
