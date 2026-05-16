-- Replace the flat ModelDefault table (added in 20260515200000, one
-- row per scope+role+featureKey+model) with the CSS-cascade
-- ModelDefaultConfig + ModelDefaultConfigScope shape.
--
-- Why the split into two migrations instead of editing 20260515200000
-- in place: that migration was deployed to dev environments before the
-- design pivot. Editing it in-place leaves those dev DBs at the old
-- shape with Prisma's _prisma_migrations table claiming the migration
-- ran cleanly, so the resolver sees the new code but the old columns
-- (per `feedback_never_modify_deployed_migrations` — editing migrations
-- after they apply silently corrupts dev/CI environments). This new
-- migration drops the old table + creates the new shape, applies
-- cleanly to:
--   - dev DBs that ran 20260515200000 yesterday (they DROP an existing
--     table + create the new pair)
--   - CI testcontainers and fresh checkouts (they first run
--     20260515200000 creating the flat table, then this migration
--     drops it and creates the cascade pair — wasteful by a few
--     milliseconds, but correct)
--   - production after merge (neither migration has been deployed,
--     they run in sequence: create flat, drop flat, create cascade,
--     lift legacy scalar columns).
--
-- Shape:
--   ModelDefaultConfig       — one row per cascade policy. The JSON
--                              payload maps role names (DEFAULT / FAST /
--                              EMBEDDINGS) and feature keys (e.g.
--                              prompt.create_default) to a model id.
--                              Absent key = "inherit from parent scope".
--   ModelDefaultConfigScope  — n:n join binding a config to a
--                              (scopeType, scopeId). One config can
--                              apply to many scopes; one scope can
--                              have many configs (resolver tiebreaks
--                              by createdAt DESC).
--
-- The CSS-cascade rules and the JSON contract live in
-- specs/model-providers/model-default-config-cascade.feature.

-- Drop the previous flat table. The enum type stays — it's still the
-- right enum for the new scope column.
DROP TABLE IF EXISTS "ModelDefault";

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

-- Data lift: pack the legacy Organization/Team/Project scalar columns
-- into config JSON, one config per (scopeType, scopeId) that had any
-- non-null value. jsonb_strip_nulls drops keys whose value was NULL
-- so a partial legacy row (e.g. only defaultModel set) ends up with
-- the corresponding partial config JSON — and the resolver treats
-- key-absence as "inherit from parent scope". Deterministic IDs
-- ('mdcfg_<scope>_<id>') so the two-step INSERT can link config +
-- scope without a CTE/RETURNING dance.

INSERT INTO "ModelDefaultConfig" ("id", "config", "updatedAt")
SELECT
    'mdcfg_org_' || o."id",
    jsonb_strip_nulls(jsonb_build_object(
        'DEFAULT', o."defaultModel",
        'analytics.topic_clustering_llm', o."topicClusteringModel",
        'EMBEDDINGS', o."embeddingsModel"
    )),
    NOW()
FROM "Organization" o
WHERE o."defaultModel" IS NOT NULL
   OR o."topicClusteringModel" IS NOT NULL
   OR o."embeddingsModel" IS NOT NULL;

INSERT INTO "ModelDefaultConfigScope" ("id", "configId", "scopeType", "scopeId")
SELECT
    'mdcs_org_' || o."id",
    'mdcfg_org_' || o."id",
    'ORGANIZATION'::"ModelDefaultScopeType",
    o."id"
FROM "Organization" o
WHERE o."defaultModel" IS NOT NULL
   OR o."topicClusteringModel" IS NOT NULL
   OR o."embeddingsModel" IS NOT NULL;

INSERT INTO "ModelDefaultConfig" ("id", "config", "updatedAt")
SELECT
    'mdcfg_team_' || t."id",
    jsonb_strip_nulls(jsonb_build_object(
        'DEFAULT', t."defaultModel",
        'analytics.topic_clustering_llm', t."topicClusteringModel",
        'EMBEDDINGS', t."embeddingsModel"
    )),
    NOW()
FROM "Team" t
WHERE t."defaultModel" IS NOT NULL
   OR t."topicClusteringModel" IS NOT NULL
   OR t."embeddingsModel" IS NOT NULL;

INSERT INTO "ModelDefaultConfigScope" ("id", "configId", "scopeType", "scopeId")
SELECT
    'mdcs_team_' || t."id",
    'mdcfg_team_' || t."id",
    'TEAM'::"ModelDefaultScopeType",
    t."id"
FROM "Team" t
WHERE t."defaultModel" IS NOT NULL
   OR t."topicClusteringModel" IS NOT NULL
   OR t."embeddingsModel" IS NOT NULL;

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

-- To roll back, drop both tables and re-create the flat ModelDefault
-- table from 20260515200000. The legacy scalar columns on
-- Organization/Team/Project are untouched, so reads continue to work
-- via the resolver's compat fallback even mid-rollback. Down
-- migration commented out to prevent accidental data loss.
