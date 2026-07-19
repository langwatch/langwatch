-- Cascading default models: single migration that produces the final
-- shape introduced by this PR. Five intermediate migrations were
-- collapsed (none had shipped to prod) so there is no point in adding
-- the legacy scalar columns to Team/Organization, packing them into a
-- flat ModelDefault table, then immediately reshaping into a config +
-- scope pair and dropping the legacy columns again. This migration
-- skips straight to the target state.
--
-- Net effect against the pre-PR schema:
--   1. ModelProviderScope.scopeType becomes a typed enum (was TEXT).
--   2. ModelDefaultConfig + ModelDefaultConfigScope tables back the
--      cascading default-model resolver. One config carries a JSON
--      payload mapping role names (DEFAULT / FAST / EMBEDDINGS) and
--      feature keys to model ids; absence of a key means "inherit from
--      the next scope up". The scope join lets one config attach to N
--      (scopeType, scopeId) pairs.
--   3. Project.defaultModel / topicClusteringModel / embeddingsModel
--      drop after their values lift into ModelDefaultConfig rows at
--      PROJECT scope. Team and Organization never had these scalars on
--      main (a discarded intermediate added them), so no DROP needed
--      there.
--
-- Cascading rules + JSON contract live in
-- specs/model-providers/model-default-config-cascade.feature.

-- 1. ModelProviderScope.scopeType: TEXT -> enum.
CREATE TYPE "ModelProviderScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT');

ALTER TABLE "ModelProviderScope"
    ALTER COLUMN "scopeType" TYPE "ModelProviderScopeType"
    USING ("scopeType"::"ModelProviderScopeType");

-- 2. ModelDefault* schema. The scope-type enum is its own enum (per
-- the scoped-resources convention in
-- dev/docs/best_practices/scoped-resources.md) — mirrors
-- RoleBindingScopeType and GatewayBudgetScopeType for the same
-- reasons: keep invalid values out at storage time instead of relying
-- on application guards.
CREATE TYPE "ModelDefaultScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT');

CREATE TABLE "ModelDefaultConfig" (
    "id"        TEXT NOT NULL,
    "config"    JSONB NOT NULL,
    "authorId"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelDefaultConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelDefaultConfigScope" (
    "id"        TEXT NOT NULL,
    "configId"  TEXT NOT NULL,
    "scopeType" "ModelDefaultScopeType" NOT NULL,
    "scopeId"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelDefaultConfigScope_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ModelDefaultConfigScope_configId_fkey"
        FOREIGN KEY ("configId") REFERENCES "ModelDefaultConfig"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ModelDefaultConfigScope_unique"
    ON "ModelDefaultConfigScope" ("configId", "scopeType", "scopeId");

CREATE INDEX "ModelDefaultConfigScope_scope_idx"
    ON "ModelDefaultConfigScope" ("scopeType", "scopeId");

CREATE INDEX "ModelDefaultConfigScope_configId_idx"
    ON "ModelDefaultConfigScope" ("configId");

-- 3. Data lift: pack Project's legacy scalar columns into a per-project
-- config + scope row. jsonb_strip_nulls drops keys whose value was NULL
-- so a partial legacy row (e.g. only defaultModel set) yields a partial
-- config JSON — the resolver treats absent keys as "inherit from the
-- parent scope". Deterministic IDs ('mdcfg_proj_<id>') so the two-step
-- INSERT can link config + scope without CTE/RETURNING.
INSERT INTO "ModelDefaultConfig" ("id", "config", "updatedAt")
SELECT
    'mdcfg_proj_' || p."id",
    jsonb_strip_nulls(jsonb_build_object(
        'DEFAULT', p."defaultModel",
        'analytics.topic_clustering_llm', p."topicClusteringModel",
        'EMBEDDINGS', p."embeddingsModel"
    )),
    NOW()
FROM "Project" p
WHERE p."defaultModel" IS NOT NULL
   OR p."topicClusteringModel" IS NOT NULL
   OR p."embeddingsModel" IS NOT NULL;

INSERT INTO "ModelDefaultConfigScope" ("id", "configId", "scopeType", "scopeId")
SELECT
    'mdcs_proj_' || p."id",
    'mdcfg_proj_' || p."id",
    'PROJECT'::"ModelDefaultScopeType",
    p."id"
FROM "Project" p
WHERE p."defaultModel" IS NOT NULL
   OR p."topicClusteringModel" IS NOT NULL
   OR p."embeddingsModel" IS NOT NULL;

-- 4. Drop the legacy scalar columns. No application code reads them
-- anymore; the resolver and every consumer go through
-- resolveModelForFeature / modelProvider.getResolvedDefault. The
-- IF EXISTS guards Team / Organization in case a dev DB still carries
-- columns added by a discarded intermediate migration.
ALTER TABLE "Project"
    DROP COLUMN IF EXISTS "defaultModel",
    DROP COLUMN IF EXISTS "topicClusteringModel",
    DROP COLUMN IF EXISTS "embeddingsModel";

ALTER TABLE "Team"
    DROP COLUMN IF EXISTS "defaultModel",
    DROP COLUMN IF EXISTS "topicClusteringModel",
    DROP COLUMN IF EXISTS "embeddingsModel";

ALTER TABLE "Organization"
    DROP COLUMN IF EXISTS "defaultModel",
    DROP COLUMN IF EXISTS "topicClusteringModel",
    DROP COLUMN IF EXISTS "embeddingsModel";
