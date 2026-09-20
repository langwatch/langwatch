-- IRREVERSIBLE: no down step. Reversing it would drop IssuedLicense with every
-- license LangWatch has recorded, and drop Organization.selfHostedCustomer.
-- The registry table is the only copy of that record: a reissued license
-- waiting for its install, a revocation and its reason, and the commercial
-- terms a customer's invoices are computed from all live here and nowhere
-- else. Rolling the code back is safe and leaves the table unread. Rolling the
-- data back is a restore from backup, not a reverse migration.
--
-- The license registry (ADR-139).
--
-- IssuedLicense records every license LangWatch issues. A license linked to a
-- customer organization on LangWatch Cloud can have a hosted service switched
-- on, be revoked, and have its hosted usage billed to the right account,
-- without changing the license format an install already holds. organizationId
-- is nullable: a self-serve purchase is recorded unlinked and resolves to
-- nothing until an operator links it.
--
-- tokenHash is the SHA-256 of the lwl_ token an install presents. The token
-- itself is never stored, so read access to this table is not credential access.
--
-- Organization.selfHostedCustomer marks the customer organizations that hosted
-- usage, budgets and invoices attach to.
--
-- Additive only: one new enum, one new table, one new column with a default.
-- A self-hosted install gets the table and keeps it empty.

-- CreateEnum
CREATE TYPE "IssuedLicenseSource" AS ENUM ('BACKOFFICE', 'PURCHASE', 'SCRIPT', 'LEGACY_IMPORT');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "selfHostedCustomer" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "IssuedLicense" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "organizationId" TEXT,
    "organizationName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "maxMembersLite" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "source" "IssuedLicenseSource" NOT NULL,
    "issuedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "replacesId" TEXT,
    "pendingDeliveryLicense" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seatOverageAllowance" INTEGER,
    "seatRateCents" INTEGER,
    "seatCurrency" "Currency",
    "commitUsdCents" INTEGER NOT NULL DEFAULT 0,
    "overageEnabled" BOOLEAN NOT NULL DEFAULT false,
    "overageMaxUsdCents" INTEGER,
    "instanceId" TEXT,
    "instanceBoundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuedLicense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssuedLicense_licenseId_key" ON "IssuedLicense"("licenseId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedLicense_tokenHash_key" ON "IssuedLicense"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedLicense_replacesId_key" ON "IssuedLicense"("replacesId");

-- CreateIndex
CREATE INDEX "IssuedLicense_organizationId_idx" ON "IssuedLicense"("organizationId");

-- CreateIndex
CREATE INDEX "IssuedLicense_expiresAt_idx" ON "IssuedLicense"("expiresAt");
