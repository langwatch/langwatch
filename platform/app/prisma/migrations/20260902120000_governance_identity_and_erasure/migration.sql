-- Governance identity and erasure (ADR-128 wave 2, §9 and §11).
--
-- Five tables that let the governance screens say WHO spent the money, and let
-- a GDPR erasure actually hold against a pipeline whose whole job is to
-- re-fetch the same thirty days tomorrow.
--
-- All five are keyed by "organizationId", never by the hidden governance
-- project. That project's id is the ClickHouse TenantId, and it is not durable:
-- the read path filters archived projects and the write path does not, so one
-- archive/re-mint cycle would orphan every row here and an erasure job walking
-- that key would miss an erased person's data entirely.
-- "GovernanceTenantHistory" is the durable translation instead.
--
-- NO EXTENSIONS. An earlier draft held "no two links for one person may
-- overlap in time" with a btree_gist exclusion constraint - the first
-- CREATE EXTENSION in this repo, and a new requirement on every self-hosted
-- and managed Postgres. Nothing here ever writes "validTo", so the only
-- overlap that can occur is a second OPEN link, and a plain partial unique
-- index holds that rule with no extension at all (ADR-128 §7).

-- +-------------------------------------------------------------------------+
-- | DiscoveredPerson - the unit of erasure                                   |
-- +-------------------------------------------------------------------------+
-- Not a login and not a platform user. Most of these people have no LangWatch
-- account at all, which is exactly why erasure is keyed here: there is no
-- userId to key on for the majority, and a user-deletion event can never fire
-- for them.
CREATE TABLE "DiscoveredPerson" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "rawActorId" TEXT NOT NULL,
    "displayText" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "erasedAt" TIMESTAMP(3),
    -- Set with "erasedAt" and cleared once the daily cost rows have been
    -- removed and their rebuild requested. Non-null means the ClickHouse half
    -- of the erasure is unfinished, so a re-run resumes there instead of
    -- reading "erasedAt", short-circuiting, and reporting a clean erasure that
    -- did no work.
    "moneyRowsPendingAt" TIMESTAMP(3),
    -- The earliest day to rebuild from, recorded before the rows are deleted:
    -- afterwards there is nothing left to ask which days they were on.
    "moneyRebuildSince" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredPerson_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscoveredPerson_organizationId_provider_rawActorId_key" ON "DiscoveredPerson"("organizationId", "provider", "rawActorId");

-- The identity screens list an organization's people newest-seen first.
CREATE INDEX "DiscoveredPerson_organizationId_lastSeenAt_idx" ON "DiscoveredPerson"("organizationId", "lastSeenAt");

-- +-------------------------------------------------------------------------+
-- | DiscoveredAgent - the same shape for non-human actors                    |
-- +-------------------------------------------------------------------------+
CREATE TABLE "DiscoveredAgent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "rawAgentId" TEXT NOT NULL,
    "displayText" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredAgent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscoveredAgent_organizationId_provider_rawAgentId_key" ON "DiscoveredAgent"("organizationId", "provider", "rawAgentId");

CREATE INDEX "DiscoveredAgent_organizationId_lastSeenAt_idx" ON "DiscoveredAgent"("organizationId", "lastSeenAt");

-- +-------------------------------------------------------------------------+
-- | IdentityMatch - the dated match table                                    |
-- +-------------------------------------------------------------------------+
CREATE TABLE "IdentityMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "discoveredPersonId" TEXT NOT NULL,
    "userId" TEXT,
    "evidenceKind" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityMatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IdentityMatch_organizationId_discoveredPersonId_idx" ON "IdentityMatch"("organizationId", "discoveredPersonId");

-- Offboarding and the erasure walk both ask "which links does this user hold".
CREATE INDEX "IdentityMatch_organizationId_userId_idx" ON "IdentityMatch"("organizationId", "userId");

-- A zero-width "link" (validFrom = validTo) has "validTo" set, so the
-- one-open-link index below cannot see it: it would file a person against no
-- time at all and read as if the link had never been made. An inverted range
-- raises a raw type error (SQLSTATE 22000) that no layer maps. One named
-- CHECK rejects both, in the database.
ALTER TABLE "IdentityMatch" ADD CONSTRAINT "IdentityMatch_valid_range_check"
    CHECK ("validTo" IS NULL OR "validTo" > "validFrom");

-- At most one OPEN link ("validTo" IS NULL) per discovered person; a second
-- one is rejected with SQLSTATE 23505. This deliberately says nothing about
-- CLOSED links overlapping in time: nothing in the product writes "validTo"
-- yet, so no closed row can exist, and the general overlap rule it replaces
-- (an EXCLUDE USING gist constraint) bought that unreachable guarantee at the
-- price of a btree_gist extension requirement on every Postgres. Revisit when
-- closing links ships (ADR-128 §7).
CREATE UNIQUE INDEX "IdentityMatch_one_open_link_key"
    ON "IdentityMatch"("discoveredPersonId")
    WHERE "validTo" IS NULL;

-- +-------------------------------------------------------------------------+
-- | GovernanceTenantHistory - org to every tenant it ever wrote under         |
-- +-------------------------------------------------------------------------+
CREATE TABLE "GovernanceTenantHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstUsedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovernanceTenantHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GovernanceTenantHistory_organizationId_tenantId_key" ON "GovernanceTenantHistory"("organizationId", "tenantId");

CREATE INDEX "GovernanceTenantHistory_organizationId_idx" ON "GovernanceTenantHistory"("organizationId");

-- Backfill, and it is load-bearing rather than a convenience. Without it the
-- history is empty for every organization that already ingested, so the first
-- erasure after this migration would resolve zero tenants, delete nothing from
-- ClickHouse, and report success - the exact silent failure the table exists to
-- prevent. Archived governance projects are INCLUDED: an archived tenant still
-- holds the rows written under it, and reaching them is the whole point.
INSERT INTO "GovernanceTenantHistory" ("id", "organizationId", "tenantId", "firstUsedAt", "lastUsedAt")
SELECT
    'gth_' || replace(gen_random_uuid()::text, '-', ''),
    "Team"."organizationId",
    "Project"."id",
    "Project"."createdAt",
    "Project"."updatedAt"
FROM "Project"
JOIN "Team" ON "Team"."id" = "Project"."teamId"
WHERE "Project"."kind" = 'internal_governance'
ON CONFLICT ("organizationId", "tenantId") DO NOTHING;

-- +-------------------------------------------------------------------------+
-- | ErasedIdentifierSuppression - the do-not-reimport list                   |
-- +-------------------------------------------------------------------------+
-- Hashes, never identifiers. The digest stored here and the pseudonym written
-- in place of the erased value are one function of one input, computed once per
-- write and used for both the lookup and the replacement - which is why there
-- is no original-to-pseudonym mapping table anywhere. One would keep the erased
-- identifier in plaintext forever, which is the opposite of what the erasure
-- was for.
CREATE TABLE "ErasedIdentifierSuppression" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "identifierHash" TEXT NOT NULL,
    "erasedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErasedIdentifierSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ErasedIdentifierSuppression_organizationId_provider_hash_key" ON "ErasedIdentifierSuppression"("organizationId", "provider", "identifierHash");

-- The snapshot every write path reads: one organization's whole list.
CREATE INDEX "ErasedIdentifierSuppression_organizationId_idx" ON "ErasedIdentifierSuppression"("organizationId");

-- IRREVERSIBLE: dropping "ErasedIdentifierSuppression" un-erases people.
--
-- The list is the only record of which identifiers must never be re-imported.
-- The identifiers themselves are gone by design - only their digests survive,
-- and a digest cannot be recomputed without the original. Drop this table and
-- the next thirty-day-lookback pull re-ingests every erased email address, with
-- nothing anywhere to say it should not have.
--
-- The other four tables are ordinary DROPs, but "DiscoveredPerson" holds rows
-- whose identifiers were pseudonymized in place: dropping it does not restore
-- what was erased either, it only discards the spend attribution that survived.
--
-- Repair goes forward, in a new migration. To reverse this deliberately, deal
-- with the erasure record FIRST - that is a data decision, not a schema one, so
-- it is not scripted here.
--   DROP TABLE "ErasedIdentifierSuppression";
--   DROP TABLE "GovernanceTenantHistory";
--   DROP TABLE "IdentityMatch";
--   DROP TABLE "DiscoveredAgent";
--   DROP TABLE "DiscoveredPerson";
