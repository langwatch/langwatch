-- The identity pipeline's projection tables (ADR-101, D01 PR 1 - see
-- specs/identity/identifier-model.feature). Everything here is additive and
-- dark: Identifier is a pure event-truth projection nothing reads until D03,
-- IdentityProjectionCursor is its fold cursor, and User.userHashKey is the
-- per-user HMAC key identity event hashes derive from (minted at user
-- creation, shredded on erasure).
--
-- To roll back, uncomment and run manually. Dropping the tables loses only
-- fold-written projection state, which replay rebuilds from the event log;
-- dropping userHashKey orphans every identifierHash already emitted.
-- DROP TABLE "Identifier";
-- DROP TABLE "IdentityProjectionCursor";
-- ALTER TABLE "User" DROP COLUMN "userHashKey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "userHashKey" TEXT;

-- CreateTable
CREATE TABLE "Identifier" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "value" TEXT,
    "domain" TEXT,
    "identifierHash" TEXT,
    "accountId" TEXT,
    "state" TEXT NOT NULL,
    "connectionId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "attachedAt" TIMESTAMP(3) NOT NULL,
    "detachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Identifier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Identifier_userId_idx" ON "Identifier"("userId");

-- CreateIndex
CREATE INDEX "Identifier_identifierHash_idx" ON "Identifier"("identifierHash");

-- CreateIndex
CREATE INDEX "Identifier_value_idx" ON "Identifier"("value");

-- CreateIndex
CREATE INDEX "Identifier_domain_idx" ON "Identifier"("domain");

-- CreateTable
CREATE TABLE "IdentityProjectionCursor" (
    "userId" TEXT NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityProjectionCursor_pkey" PRIMARY KEY ("userId")
);
