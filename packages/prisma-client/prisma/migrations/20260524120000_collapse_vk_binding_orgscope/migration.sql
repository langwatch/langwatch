-- Iter-110 collapse-VK-binding + org-scope VirtualKey migration.
--
-- Forward-only multi-step sequence. No rollback: the gateway tables
-- are deployed in prod (no live users) but the schema is shared, so
-- the migration runs cleanly against existing rows while never
-- recreating dropped objects.
--
-- Governance tables (IngestionSource, AnomalyRule, etc.) are handled
-- separately in the J1 migration (truncate + dogfood seed); J2 here
-- is gateway-only.
--
-- See: tmp/REFACTOR-PLAN-vk-modelprovider.md §"Migration strategy"

-- ---------------------------------------------------------------------------
-- Step 1: new enums.
-- ---------------------------------------------------------------------------

CREATE TYPE "VirtualKeyScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT');
CREATE TYPE "RoutingPolicyScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT');

-- ---------------------------------------------------------------------------
-- Step 2: VirtualKeyScope join table.
-- ---------------------------------------------------------------------------

CREATE TABLE "VirtualKeyScope" (
    "id" TEXT NOT NULL,
    "virtualKeyId" TEXT NOT NULL,
    "scopeType" "VirtualKeyScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VirtualKeyScope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VirtualKeyScope_virtualKeyId_scopeType_scopeId_key"
    ON "VirtualKeyScope"("virtualKeyId", "scopeType", "scopeId");
CREATE INDEX "VirtualKeyScope_scopeType_scopeId_idx"
    ON "VirtualKeyScope"("scopeType", "scopeId");
CREATE INDEX "VirtualKeyScope_virtualKeyId_idx"
    ON "VirtualKeyScope"("virtualKeyId");

-- ---------------------------------------------------------------------------
-- Step 3: VirtualKey.organizationId — nullable add, backfill, then NOT NULL.
-- ---------------------------------------------------------------------------

ALTER TABLE "VirtualKey" ADD COLUMN "organizationId" TEXT;

UPDATE "VirtualKey" vk
SET "organizationId" = t."organizationId"
FROM "Project" p
JOIN "Team" t ON p."teamId" = t."id"
WHERE vk."projectId" = p."id";

-- Backfill 1 VirtualKeyScope row per existing VK reproducing its old
-- projectId as scopeType=PROJECT. Preserves access semantics: every
-- existing key continues to be reachable from the same project after
-- the column drop.
INSERT INTO "VirtualKeyScope" ("id", "virtualKeyId", "scopeType", "scopeId", "createdAt")
SELECT
    -- Stable per-VK id via concat; collision-safe because every VK
    -- gets exactly one PROJECT-scope row in this backfill.
    'vks_' || "id",
    "id",
    'PROJECT'::"VirtualKeyScopeType",
    "projectId",
    CURRENT_TIMESTAMP
FROM "VirtualKey"
WHERE "projectId" IS NOT NULL;

ALTER TABLE "VirtualKey" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE INDEX "VirtualKey_organizationId_idx" ON "VirtualKey"("organizationId");

-- Drop the (projectId, name) unique. The old invariant allowed two
-- projects in one org to hold a same-named key, so promoting it to a
-- transient (organizationId, name) unique here could fail mid-migration
-- on existing data. VK identity is the row id post-iter-110 and name
-- uniqueness is dropped entirely a few migrations later, so no
-- replacement unique is created.
DROP INDEX IF EXISTS "VirtualKey_projectId_name_key";

-- ---------------------------------------------------------------------------
-- Step 4: ModelProvider — add advanced gateway fields, backfill from GPC.
-- ---------------------------------------------------------------------------

ALTER TABLE "ModelProvider" ADD COLUMN "rateLimitRpm" INTEGER;
ALTER TABLE "ModelProvider" ADD COLUMN "rateLimitTpm" INTEGER;
ALTER TABLE "ModelProvider" ADD COLUMN "rateLimitRpd" INTEGER;
ALTER TABLE "ModelProvider" ADD COLUMN "rotationPolicy" "GatewayProviderRotationPolicy" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "ModelProvider" ADD COLUMN "providerConfig" JSONB;
ALTER TABLE "ModelProvider" ADD COLUMN "fallbackPriorityGlobal" INTEGER;
ALTER TABLE "ModelProvider" ADD COLUMN "healthStatus" "GatewayProviderHealthStatus" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "ModelProvider" ADD COLUMN "circuitOpenedAt" TIMESTAMP(3);
ALTER TABLE "ModelProvider" ADD COLUMN "lastHealthCheckAt" TIMESTAMP(3);
ALTER TABLE "ModelProvider" ADD COLUMN "disabledAt" TIMESTAMP(3);

-- Backfill 1:1 from the existing GatewayProviderCredential rows.
-- Pre-iter-110 each ModelProvider typically had 0 or 1 GPC (the
-- multi-slot multi-row case was rare and uses the slot column we're
-- dropping). For the rare multi-GPC case, the lowest-id (oldest) GPC
-- wins — same deterministic tiebreak as fallbackPriorityGlobal.
UPDATE "ModelProvider" mp
SET
    "rateLimitRpm"           = gpc."rateLimitRpm",
    "rateLimitTpm"           = gpc."rateLimitTpm",
    "rateLimitRpd"           = gpc."rateLimitRpd",
    "rotationPolicy"         = gpc."rotationPolicy",
    "providerConfig"         = gpc."providerConfig",
    "fallbackPriorityGlobal" = gpc."fallbackPriorityGlobal",
    "healthStatus"           = gpc."healthStatus",
    "circuitOpenedAt"        = gpc."circuitOpenedAt",
    "lastHealthCheckAt"      = gpc."lastHealthCheckAt",
    "disabledAt"             = gpc."disabledAt",
    -- GPC also held an extraHeaders that overrode the MP's own; merge
    -- the GPC value in (MP value wins if both set — operator-set MP
    -- headers are intentional).
    "extraHeaders"           = COALESCE(mp."extraHeaders", gpc."extraHeaders")
FROM (
    SELECT DISTINCT ON ("modelProviderId")
        "modelProviderId",
        "rateLimitRpm", "rateLimitTpm", "rateLimitRpd",
        "rotationPolicy", "extraHeaders", "providerConfig",
        "fallbackPriorityGlobal", "healthStatus",
        "circuitOpenedAt", "lastHealthCheckAt", "disabledAt"
    FROM "GatewayProviderCredential"
    ORDER BY "modelProviderId", "id" ASC
) gpc
WHERE mp."id" = gpc."modelProviderId";

CREATE INDEX "ModelProvider_healthStatus_idx" ON "ModelProvider"("healthStatus");
CREATE INDEX "ModelProvider_fallbackPriorityGlobal_idx" ON "ModelProvider"("fallbackPriorityGlobal");

-- ---------------------------------------------------------------------------
-- Step 5: RoutingPolicy.scope String → enum.
-- ---------------------------------------------------------------------------

-- Add a new typed column, backfill from the old text column.
ALTER TABLE "RoutingPolicy" ADD COLUMN "scope_new" "RoutingPolicyScopeType";

UPDATE "RoutingPolicy" SET "scope_new" = CASE
    WHEN "scope" = 'organization' THEN 'ORGANIZATION'::"RoutingPolicyScopeType"
    WHEN "scope" = 'team'         THEN 'TEAM'::"RoutingPolicyScopeType"
    WHEN "scope" = 'project'      THEN 'PROJECT'::"RoutingPolicyScopeType"
END;

ALTER TABLE "RoutingPolicy" ALTER COLUMN "scope_new" SET NOT NULL;

-- Swap: drop the old text column + its indexes, rename the new column.
DROP INDEX IF EXISTS "RoutingPolicy_scope_scopeId_idx";
DROP INDEX IF EXISTS "RoutingPolicy_organizationId_scope_scopeId_name_key";

ALTER TABLE "RoutingPolicy" DROP COLUMN "scope";
ALTER TABLE "RoutingPolicy" RENAME COLUMN "scope_new" TO "scope";

CREATE INDEX "RoutingPolicy_scope_scopeId_idx"
    ON "RoutingPolicy"("scope", "scopeId");
CREATE UNIQUE INDEX "RoutingPolicy_organizationId_scope_scopeId_name_key"
    ON "RoutingPolicy"("organizationId", "scope", "scopeId", "name");

-- Rename providerCredentialIds → modelProviderIds. Same JSON shape;
-- the IDs themselves remain valid because GPC.modelProviderId was a
-- 1:1 lookup that becomes the post-fold MP.id directly.
ALTER TABLE "RoutingPolicy" RENAME COLUMN "providerCredentialIds" TO "modelProviderIds";

-- Backfill: any RoutingPolicy whose `modelProviderIds` still contains
-- GPC ids (pre-collapse) needs them translated to MP ids. JSON array
-- of strings; translate each via the GPC→MP join.
UPDATE "RoutingPolicy" rp
SET "modelProviderIds" = COALESCE((
    SELECT jsonb_agg(gpc."modelProviderId" ORDER BY ord.idx)
    FROM jsonb_array_elements_text(rp."modelProviderIds") WITH ORDINALITY AS ord(gpc_id, idx)
    LEFT JOIN "GatewayProviderCredential" gpc ON gpc."id" = ord.gpc_id
    WHERE gpc."modelProviderId" IS NOT NULL
), '[]'::jsonb)
WHERE jsonb_array_length(rp."modelProviderIds") > 0;

-- ---------------------------------------------------------------------------
-- Step 6: GatewayBudgetLedger — providerCredentialId → modelProviderId.
-- ---------------------------------------------------------------------------

ALTER TABLE "GatewayBudgetLedger" ADD COLUMN "modelProviderId" TEXT;

UPDATE "GatewayBudgetLedger" l
SET "modelProviderId" = gpc."modelProviderId"
FROM "GatewayProviderCredential" gpc
WHERE l."providerCredentialId" = gpc."id";

ALTER TABLE "GatewayBudgetLedger" DROP COLUMN "providerCredentialId";
ALTER TABLE "GatewayBudgetLedger" DROP COLUMN "providerSlot";

-- ---------------------------------------------------------------------------
-- Step 7: drop now-dead tables (VirtualKeyProviderCredential, GPC).
-- ---------------------------------------------------------------------------

DROP TABLE "VirtualKeyProviderCredential";
DROP TABLE "GatewayProviderCredential";

-- ---------------------------------------------------------------------------
-- Step 8: drop legacy columns on VirtualKey + ModelProvider.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "VirtualKey_projectId_idx";
ALTER TABLE "VirtualKey" DROP COLUMN "projectId";

DROP INDEX IF EXISTS "ModelProvider_projectId_idx";
ALTER TABLE "ModelProvider" DROP COLUMN "projectId";

-- Slot column on GPC is gone with the table drop above. No-op on MP
-- because MP never had a slot column (it lived only on GPC).

-- ---------------------------------------------------------------------------
-- Step 9: GatewayChangeEvent — column + enum rename.
-- The binding-update event kind + the per-event provider id pointed at
-- GPC pre-collapse; both now point at ModelProvider directly.
-- ---------------------------------------------------------------------------

ALTER TYPE "GatewayChangeEventKind"
    RENAME VALUE 'PROVIDER_BINDING_UPDATED' TO 'MODEL_PROVIDER_UPDATED';

ALTER TABLE "GatewayChangeEvent"
    RENAME COLUMN "providerCredentialId" TO "modelProviderId";
