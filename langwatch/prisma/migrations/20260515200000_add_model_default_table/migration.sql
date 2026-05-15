-- ModelDefault is the single source of truth for "which model does
-- {feature, role} resolve to at {scope}". Replaces the per-scope
-- defaultModel / topicClusteringModel / embeddingsModel scalar columns
-- added in 20260515150000 (which stay readable for one release as a
-- compat fallback — the resolver in B3.1 prefers ModelDefault rows and
-- only walks the legacy columns when no row exists).
--
-- Row shape:
--   featureKey IS NULL → role-level default for the scope
--   featureKey populated → per-feature override (rarely needed but the
--                          escape hatch when a single feature wants a
--                          different model than its role's default)
--
-- Postgres treats NULLs as DISTINCT in unique indexes by default, so a
-- single composite unique on (scopeType, scopeId, role, featureKey)
-- would NOT prevent two role-level rows for the same (scope, role).
-- Two partial unique indexes give the semantics we want without a
-- single index that conflates "no override" with "override=empty".

CREATE TABLE "ModelDefault" (
    "id"         TEXT NOT NULL,
    "scopeType"  TEXT NOT NULL,
    "scopeId"    TEXT NOT NULL,
    "role"       TEXT NOT NULL,
    "featureKey" TEXT,
    "model"      TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,
    "authorId"   TEXT,

    CONSTRAINT "ModelDefault_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ModelDefault_scope_role_idx"
    ON "ModelDefault" ("scopeType", "scopeId", "role");

CREATE UNIQUE INDEX "ModelDefault_scope_role_unique_role_level"
    ON "ModelDefault" ("scopeType", "scopeId", "role")
    WHERE "featureKey" IS NULL;

CREATE UNIQUE INDEX "ModelDefault_scope_role_feature_unique_feature_override"
    ON "ModelDefault" ("scopeType", "scopeId", "role", "featureKey")
    WHERE "featureKey" IS NOT NULL;

-- Data migration: lift the B2 scalar columns into ModelDefault rows.
-- The mapping is 1:1 with no sniffing — topicClusteringModel was always
-- an LLM, embeddingsModel was always an embedding model. The resolver
-- will continue to read the legacy columns when no row exists, so this
-- migration is additive and existing reads keep working.

INSERT INTO "ModelDefault" ("id", "scopeType", "scopeId", "role", "featureKey", "model", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'ORGANIZATION',
    "id",
    'DEFAULT',
    NULL,
    "defaultModel",
    NOW()
FROM "Organization"
WHERE "defaultModel" IS NOT NULL;

INSERT INTO "ModelDefault" ("id", "scopeType", "scopeId", "role", "featureKey", "model", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'ORGANIZATION',
    "id",
    'FAST',
    'analytics.topic_clustering_llm',
    "topicClusteringModel",
    NOW()
FROM "Organization"
WHERE "topicClusteringModel" IS NOT NULL;

INSERT INTO "ModelDefault" ("id", "scopeType", "scopeId", "role", "featureKey", "model", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'ORGANIZATION',
    "id",
    'EMBEDDINGS',
    NULL,
    "embeddingsModel",
    NOW()
FROM "Organization"
WHERE "embeddingsModel" IS NOT NULL;

INSERT INTO "ModelDefault" ("id", "scopeType", "scopeId", "role", "featureKey", "model", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'TEAM',
    "id",
    'DEFAULT',
    NULL,
    "defaultModel",
    NOW()
FROM "Team"
WHERE "defaultModel" IS NOT NULL;

INSERT INTO "ModelDefault" ("id", "scopeType", "scopeId", "role", "featureKey", "model", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'TEAM',
    "id",
    'FAST',
    'analytics.topic_clustering_llm',
    "topicClusteringModel",
    NOW()
FROM "Team"
WHERE "topicClusteringModel" IS NOT NULL;

INSERT INTO "ModelDefault" ("id", "scopeType", "scopeId", "role", "featureKey", "model", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'TEAM',
    "id",
    'EMBEDDINGS',
    NULL,
    "embeddingsModel",
    NOW()
FROM "Team"
WHERE "embeddingsModel" IS NOT NULL;

INSERT INTO "ModelDefault" ("id", "scopeType", "scopeId", "role", "featureKey", "model", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'PROJECT',
    "id",
    'DEFAULT',
    NULL,
    "defaultModel",
    NOW()
FROM "Project"
WHERE "defaultModel" IS NOT NULL;

INSERT INTO "ModelDefault" ("id", "scopeType", "scopeId", "role", "featureKey", "model", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'PROJECT',
    "id",
    'FAST',
    'analytics.topic_clustering_llm',
    "topicClusteringModel",
    NOW()
FROM "Project"
WHERE "topicClusteringModel" IS NOT NULL;

INSERT INTO "ModelDefault" ("id", "scopeType", "scopeId", "role", "featureKey", "model", "updatedAt")
SELECT
    gen_random_uuid()::text,
    'PROJECT',
    "id",
    'EMBEDDINGS',
    NULL,
    "embeddingsModel",
    NOW()
FROM "Project"
WHERE "embeddingsModel" IS NOT NULL;

-- To roll back, drop the ModelDefault table.
-- The legacy columns are untouched, so reads continue to work via the
-- resolver's compat fallback. Down migration commented out to prevent
-- accidental data loss.
