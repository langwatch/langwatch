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
