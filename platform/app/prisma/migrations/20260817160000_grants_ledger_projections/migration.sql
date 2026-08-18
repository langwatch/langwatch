-- The grants ledger's read side (ADR-092 §13). Every table here is a
-- PROJECTION: it holds no truth of its own, and a replay of the event stream
-- rebuilds it from empty. That is what makes the rollback below safe.
--
-- To roll back, uncomment and run manually:
--
--   DROP TABLE IF EXISTS "AuthzCutoverProjection";
--   DROP TABLE IF EXISTS "AuthzProjectionCursor";
--   DROP TABLE IF EXISTS "Role";
--   DROP TABLE IF EXISTS "Grant";
--   DROP TYPE  IF EXISTS "GrantPrincipalType";
--   DROP TYPE  IF EXISTS "GrantScopeType";
--
-- Dropping these loses no authorization state: while the engine is behind its
-- flag the legacy RoleBinding/CustomRole tables remain the source every
-- permission check answers from, and the compat head this projection also
-- writes is reconstructed on the next fold.

-- CreateEnum
CREATE TYPE "GrantScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT', 'RESOURCE', 'PLATFORM');

-- CreateEnum
CREATE TYPE "GrantPrincipalType" AS ENUM ('USER', 'API_KEY', 'GROUP', 'TEAM', 'ORGANIZATION', 'PROJECT', 'ANYONE');

-- CreateTable
CREATE TABLE "Grant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "principalType" "GrantPrincipalType" NOT NULL,
    "principalId" TEXT,
    "roleKey" TEXT,
    -- The `role` column an IMPORTED binding carried alongside a custom:<id>
    -- roleKey. The legacy resolver falls back to it when the custom role's
    -- permission list is empty, so the compat head must reproduce it, and a
    -- projection reloaded from this table must be able to reconstruct it.
    "legacyRole" TEXT,
    "source" TEXT NOT NULL,
    "scopeType" "GrantScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "token" TEXT,
    "permission" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxViews" INTEGER,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthzProjectionCursor" (
    "organizationId" TEXT NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthzProjectionCursor_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "AuthzCutoverProjection" (
    "organizationId" TEXT NOT NULL,
    "onEngine" BOOLEAN NOT NULL DEFAULT false,
    "provedAt" TIMESTAMP(3),
    "parityDiffs" JSONB,
    -- Business time of the newest cutover fact folded into this row: the
    -- reducer's monotonic guard, persisted so it survives a reload rather
    -- than resetting to "accept anything" on the next fold.
    "changedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthzCutoverProjection_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Grant_token_key" ON "Grant"("token");

-- The resource tier's two columns travel together, and they belong to that
-- tier alone: `token` IS the credential and `permission` is the single thing
-- it may do, so a row holding one without the other names a capability nobody
-- can name back, and a tokenized ORGANIZATION or TEAM row is a share
-- credential for a scope no share link may reach. Tied to `scopeType` rather
-- than merely paired, so neither shape is representable.
-- Prisma cannot express this, hence the hand-written constraint (same shape
-- as "RoleBinding_principal_check").
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_resource_terms_check" CHECK (
    ("scopeType" = 'RESOURCE' AND num_nonnulls("token", "permission") = 2)
    OR ("scopeType" <> 'RESOURCE' AND num_nonnulls("token", "permission") = 0)
);

-- CreateIndex
-- Partial on purpose: this is the collector's principal scan, and the
-- collector never reaches a RESOURCE grant that way - share links are found
-- by their token through "Grant_token_key". Share-link volume is unbounded
-- per resource (ADR-057 dropped one-share-per-resource), so indexing it here
-- would bloat the authorization hot path with rows it can never return.
CREATE INDEX "Grant_organizationId_principalType_principalId_idx" ON "Grant"("organizationId", "principalType", "principalId") WHERE "scopeType" <> 'RESOURCE';

-- CreateIndex
CREATE INDEX "Grant_organizationId_scopeType_scopeId_idx" ON "Grant"("organizationId", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "Role_organizationId_idx" ON "Role"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");

-- AlterTable
-- Business time for a per-(migration, tenant) lifecycle transition. The row
-- already had `updatedAt`, but that is wall clock: it moves when the row is
-- touched, not when the transition happened, so it cannot order a folded
-- transition against a directly written one. Concretely, a replay onto an
-- empty table creates the first row with `updatedAt = now`, and every LATER
-- fact in the same replay then fails an `updatedAt <= occurredAt` guard - the
-- table converges to the OLDEST status in the stream. Guarding on business
-- time instead makes a replay converge to the newest, while a live direct
-- write (stamped with the writer's own clock) still outranks any replayed
-- fact from the past.
--
-- Defaulted to CURRENT_TIMESTAMP so existing rows adopt backfill time: newer
-- than every historical fact, which is the safe direction - a replay can
-- never regress a row that is already live.
--
-- To roll back, uncomment and run manually:
--
--   ALTER TABLE "SystemMigrationTenantState" DROP COLUMN "occurredAt";
ALTER TABLE "SystemMigrationTenantState" ADD COLUMN "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

