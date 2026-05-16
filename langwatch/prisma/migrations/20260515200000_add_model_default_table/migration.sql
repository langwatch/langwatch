-- ModelDefaultConfig is the single source of truth for "which model does
-- {feature, role} resolve to at {scope}". Replaces the per-scope
-- defaultModel / topicClusteringModel / embeddingsModel scalar columns
-- added in 20260515150000 (the resolver still falls back to those for one
-- release while we drain writes from old code paths).
--
-- Shape:
--   ModelDefaultConfig       — one row per config policy. Holds the JSON
--                              payload mapping roles + feature keys to model
--                              ids. Absent keys = "inherit from parent scope".
--   ModelDefaultConfigScope  — n:n join binding a config to a (scopeType,
--                              scopeId). One config can apply to many scopes;
--                              one scope can have many configs (resolver
--                              tiebreaks by createdAt DESC within a scope
--                              tier).
--
-- The CSS-cascade rules and the JSON contract live in
-- specs/model-providers/model-default-config-cascade.feature.
--
-- scopeType uses its own Postgres enum following the per-table
-- convention (RoleBindingScopeType / GatewayBudgetScopeType / etc).
-- See dev/docs/best_practices/scoped-resources.md.

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

-- Data lift: pack the legacy scalar columns into config JSON, one
-- config per (scopeType, scopeId) that had any non-null value. Three
-- top-level keys we fill in:
--   DEFAULT                            <- the role's flagship model
--   analytics.topic_clustering_llm     <- per-feature override on FAST
--   EMBEDDINGS                         <- the embeddings role
--
-- jsonb_strip_nulls drops keys whose value was NULL — the resolver
-- treats key-absence as "inherit from parent scope", so a partial
-- legacy row (e.g. only defaultModel set) ends up with the
-- corresponding partial config JSON. Deterministic IDs ('mdcfg_<scope>_<id>')
-- so the two-step INSERT can link config + scope without a CTE/RETURNING
-- dance, and so re-running the migration in dev environments stays
-- idempotent on the data shape (a fresh DROP is required to re-seed).

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

-- To roll back, drop both tables + the enum.
-- The legacy scalar columns on Organization/Team/Project are untouched,
-- so reads continue to work via the resolver's compat fallback. Down
-- migration commented out to prevent accidental data loss.
