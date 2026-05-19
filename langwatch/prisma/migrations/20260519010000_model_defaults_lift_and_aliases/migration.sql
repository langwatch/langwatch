-- Model-defaults shape cleanup. Two related rewrites on
-- "ModelDefaultConfig.config" landing together so a single deploy moves
-- the table fully to the new shape.
--
-- 1. Lift legacy `analytics.topic_clustering_llm` per-feature override
--    into the FAST role on the same config.
--    Prior backfill in 20260518010000_cascading_default_models wrote
--    Project.topicClusteringModel into the per-feature key instead of
--    the FAST role, which meant new projects landed with an empty FAST
--    tier and a redundant Topic-clustering chip carrying what should
--    have been the FAST role's value.
--
--    - FAST unset       → move topic_clustering_llm into FAST
--    - FAST already set → drop topic_clustering_llm (FAST wins the
--                         resolver's role-level lookup; the override
--                         is dead weight)
--
-- 2. Rewrite DEFAULT and FAST entries that point at openai/anthropic/
--    gemini specific model ids to the `{provider}/latest` and
--    `{provider}/latest-mini` aliases. The resolver expands aliases at
--    read time so customers never get pinned to a specific model
--    version through onboarding seeds: when a newer flagship lands in
--    the catalog every alias-using customer picks it up on the next
--    request.
--
--    EMBEDDINGS, all feature-keyed overrides, and any other provider
--    (azure/bedrock/xai/voyage/perplexity/etc.) are left untouched.
--    EMBEDDINGS has no "smaller" alias concept; per-feature overrides
--    are intentional fine-grained policy and shouldn't be swept.
--
-- Idempotent: re-running this against rows already on aliases or
-- without the legacy per-feature key is a no-op because the WHERE
-- clauses match only non-alias / non-cleared values.
--
-- No down migration: this is a one-way data shape change. To roll back,
-- restore from a pre-migration export of "ModelDefaultConfig".

-- 1a. Lift topic_clustering_llm into FAST when FAST is missing, JSON
--     null, or an empty string. `config ? 'FAST'` alone returns true
--     for null / empty values, which would silently drop the legacy
--     key without setting a usable role default.
UPDATE "ModelDefaultConfig"
SET config = jsonb_set(
    config,
    '{FAST}',
    config -> 'analytics.topic_clustering_llm'
) - 'analytics.topic_clustering_llm'
WHERE config ? 'analytics.topic_clustering_llm'
  AND (
    NOT (config ? 'FAST')
    OR jsonb_typeof(config -> 'FAST') <> 'string'
    OR nullif(config ->> 'FAST', '') IS NULL
  );

-- 1b. Drop topic_clustering_llm when FAST already holds a usable
--     (non-null, non-empty) string value.
UPDATE "ModelDefaultConfig"
SET config = config - 'analytics.topic_clustering_llm'
WHERE config ? 'analytics.topic_clustering_llm'
  AND jsonb_typeof(config -> 'FAST') = 'string'
  AND nullif(config ->> 'FAST', '') IS NOT NULL;

-- 2a. DEFAULT role: any openai|anthropic|gemini value becomes {provider}/latest.
UPDATE "ModelDefaultConfig"
SET config = jsonb_set(
    config,
    '{DEFAULT}',
    to_jsonb(
        CASE
            WHEN (config->>'DEFAULT') ~ '^openai/'    THEN 'openai/latest'
            WHEN (config->>'DEFAULT') ~ '^anthropic/' THEN 'anthropic/latest'
            WHEN (config->>'DEFAULT') ~ '^gemini/'    THEN 'gemini/latest'
        END
    ),
    false
)
WHERE (config->>'DEFAULT') ~ '^(openai|anthropic|gemini)/'
  AND (config->>'DEFAULT') !~ '/(latest|latest-mini)$';

-- 2b. FAST role: any openai|anthropic|gemini value becomes {provider}/latest-mini.
UPDATE "ModelDefaultConfig"
SET config = jsonb_set(
    config,
    '{FAST}',
    to_jsonb(
        CASE
            WHEN (config->>'FAST') ~ '^openai/'    THEN 'openai/latest-mini'
            WHEN (config->>'FAST') ~ '^anthropic/' THEN 'anthropic/latest-mini'
            WHEN (config->>'FAST') ~ '^gemini/'    THEN 'gemini/latest-mini'
        END
    ),
    false
)
WHERE (config->>'FAST') ~ '^(openai|anthropic|gemini)/'
  AND (config->>'FAST') !~ '/(latest|latest-mini)$';

-- 3. Per-organization majority consolidation. Most orgs end up with
-- per-project configs that all point at the same alias provider after
-- step 2 — N identical copies the cascade would collapse to one
-- ORGANIZATION-scoped config anyway. Lift the majority alias up to ORG
-- scope and drop the redundant PROJECT rows so the resolver does one
-- walk instead of N.
--
-- Rules:
--   - Strict majority: provider must appear in > 50% of the org's
--     PROJECT-scoped configs (ties = no lift).
--   - Only providers we can alias (openai/anthropic/gemini). Azure /
--     bedrock / mixed orgs are left untouched.
--   - Skip orgs that already carry an ORGANIZATION-scoped config —
--     don't shadow existing intent.
--   - Drop PROJECT configs only when keyset ⊆ {DEFAULT, FAST} and both
--     values match the lifted alias pair. Configs that also carry
--     EMBEDDINGS or per-feature override keys stay in place; dropping
--     them would silently lose those values.
--
-- Idempotent: re-runs find no qualifying orgs (ORG config already
-- exists) and no qualifying PROJECT rows (already deleted).

-- 3a. Insert ORG-scoped config for each qualifying org.
WITH project_default_provider AS (
    SELECT
        t."organizationId" AS org_id,
        CASE
            WHEN (c.config ->> 'DEFAULT') = 'openai/latest'    THEN 'openai'
            WHEN (c.config ->> 'DEFAULT') = 'anthropic/latest' THEN 'anthropic'
            WHEN (c.config ->> 'DEFAULT') = 'gemini/latest'    THEN 'gemini'
        END AS provider
    FROM "ModelDefaultConfig" c
    JOIN "ModelDefaultConfigScope" s ON s."configId" = c.id
    JOIN "Project" p ON p.id = s."scopeId"
    JOIN "Team" t ON t.id = p."teamId"
    WHERE s."scopeType" = 'PROJECT'
),
provider_counts AS (
    SELECT org_id, provider, COUNT(*) AS n
    FROM project_default_provider
    WHERE provider IS NOT NULL
    GROUP BY org_id, provider
),
org_totals AS (
    SELECT org_id, COUNT(*) AS total
    FROM project_default_provider
    GROUP BY org_id
),
majority AS (
    SELECT pc.org_id, pc.provider
    FROM provider_counts pc
    JOIN org_totals ot USING (org_id)
    WHERE pc.n * 2 > ot.total
),
qualifying AS (
    SELECT m.org_id, m.provider
    FROM majority m
    WHERE NOT EXISTS (
        SELECT 1 FROM "ModelDefaultConfigScope" s
        WHERE s."scopeType" = 'ORGANIZATION' AND s."scopeId" = m.org_id
    )
)
INSERT INTO "ModelDefaultConfig" ("id", "config", "updatedAt")
SELECT
    'mdcfg_orglift_' || q.org_id,
    jsonb_build_object(
        'DEFAULT', q.provider || '/latest',
        'FAST',    q.provider || '/latest-mini'
    ),
    NOW()
FROM qualifying q
ON CONFLICT ("id") DO NOTHING;

-- 3b. Attach each new config to its ORG scope. Same CTE chain repeated
-- because the previous INSERT's CTE bindings don't carry over.
WITH project_default_provider AS (
    SELECT
        t."organizationId" AS org_id,
        CASE
            WHEN (c.config ->> 'DEFAULT') = 'openai/latest'    THEN 'openai'
            WHEN (c.config ->> 'DEFAULT') = 'anthropic/latest' THEN 'anthropic'
            WHEN (c.config ->> 'DEFAULT') = 'gemini/latest'    THEN 'gemini'
        END AS provider
    FROM "ModelDefaultConfig" c
    JOIN "ModelDefaultConfigScope" s ON s."configId" = c.id
    JOIN "Project" p ON p.id = s."scopeId"
    JOIN "Team" t ON t.id = p."teamId"
    WHERE s."scopeType" = 'PROJECT'
),
provider_counts AS (
    SELECT org_id, provider, COUNT(*) AS n
    FROM project_default_provider
    WHERE provider IS NOT NULL
    GROUP BY org_id, provider
),
org_totals AS (
    SELECT org_id, COUNT(*) AS total
    FROM project_default_provider
    GROUP BY org_id
),
majority AS (
    SELECT pc.org_id, pc.provider
    FROM provider_counts pc
    JOIN org_totals ot USING (org_id)
    WHERE pc.n * 2 > ot.total
),
qualifying AS (
    SELECT m.org_id, m.provider
    FROM majority m
    WHERE NOT EXISTS (
        SELECT 1 FROM "ModelDefaultConfigScope" s
        WHERE s."scopeType" = 'ORGANIZATION' AND s."scopeId" = m.org_id
    )
)
INSERT INTO "ModelDefaultConfigScope" ("id", "configId", "scopeType", "scopeId", "createdAt")
SELECT
    'mdcs_orglift_' || q.org_id,
    'mdcfg_orglift_' || q.org_id,
    'ORGANIZATION'::"ModelDefaultScopeType",
    q.org_id,
    NOW()
FROM qualifying q
ON CONFLICT ("configId", "scopeType", "scopeId") DO NOTHING;

-- 3c. Drop PROJECT configs that are now redundant — their DEFAULT/FAST
-- alias pair matches the org-level config and they carry no other
-- keys. The cascading resolver will find the same values at ORG scope.
-- The ModelDefaultConfigScope rows cascade-delete on the config FK.
DELETE FROM "ModelDefaultConfig" c
WHERE c.id IN (
    SELECT pc.id
    FROM "ModelDefaultConfig" pc
    JOIN "ModelDefaultConfigScope" ps ON ps."configId" = pc.id
    JOIN "Project" p ON p.id = ps."scopeId"
    JOIN "Team" t ON t.id = p."teamId"
    JOIN "ModelDefaultConfigScope" os
        ON os."scopeType" = 'ORGANIZATION' AND os."scopeId" = t."organizationId"
    JOIN "ModelDefaultConfig" oc ON oc.id = os."configId"
    WHERE ps."scopeType" = 'PROJECT'
      AND (pc.config ->> 'DEFAULT') ~ '^(openai|anthropic|gemini)/latest$'
      AND (pc.config ->> 'FAST')    ~ '^(openai|anthropic|gemini)/latest-mini$'
      AND (pc.config ->> 'DEFAULT') = (oc.config ->> 'DEFAULT')
      AND (pc.config ->> 'FAST')    = (oc.config ->> 'FAST')
      AND (
          SELECT COUNT(*) FROM jsonb_object_keys(pc.config) AS k
          WHERE k NOT IN ('DEFAULT', 'FAST')
      ) = 0
);
