-- ADR-185 §4: a project's braid signing keys, owned by the API key module. A new, empty table;
-- no lock on any existing table. Column refs only, no foreign key. The secret rests sealed by the
-- process encryption store in "secretCiphertext".
CREATE TABLE IF NOT EXISTS "SigningKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "verifiesUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SigningKey_publicId_key" ON "SigningKey"("publicId");

CREATE INDEX IF NOT EXISTS "SigningKey_projectId_idx" ON "SigningKey"("projectId");

CREATE INDEX IF NOT EXISTS "SigningKey_organizationId_idx" ON "SigningKey"("organizationId");
