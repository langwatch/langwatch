-- IRREVERSIBLE: additive only; drops are an Ops step.
-- ADR-180 section 2: the tokens that can only ask for a testing licence, personal or
-- service. Only the token's hash is stored, never the token.
CREATE TABLE IF NOT EXISTS "TestingLicenseToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestingLicenseToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TestingLicenseToken_tokenHash_key" ON "TestingLicenseToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "TestingLicenseToken_ownerUserId_idx" ON "TestingLicenseToken"("ownerUserId");
