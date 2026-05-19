-- Rewrite per-role default models in ModelDefaultConfig to use the
-- {provider}/latest and {provider}/latest-mini aliases for the three
-- always-available chat providers (openai/anthropic/gemini). The
-- aliases resolve at read time so customers never get pinned to a
-- specific model version through onboarding seeds — when a newer
-- flagship lands in the catalog, every alias-using customer picks it
-- up on the next request.
--
-- Scope:
--   - DEFAULT key: openai/* | anthropic/* | gemini/*  → {provider}/latest
--   - FAST    key: openai/* | anthropic/* | gemini/*  → {provider}/latest-mini
--   - EMBEDDINGS, all feature-keyed overrides, and any other provider
--     (azure/bedrock/xai/voyage/perplexity/etc.) are left untouched.
--     EMBEDDINGS has no "smaller" alias concept; per-feature overrides
--     are intentional fine-grained policy and shouldn't be swept.
--
-- Idempotent: re-running this against rows already on aliases is a
-- no-op because the WHERE clauses match only non-alias values.
--
-- Export prod state BEFORE running this in production — see the
-- migration_to_latest_aliases SELECT shared on #bugfixes for a
-- snapshot query that buckets each row by whether it'll be touched.

-- DEFAULT role: any openai|anthropic|gemini value becomes {provider}/latest.
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

-- FAST role: any openai|anthropic|gemini value becomes {provider}/latest-mini.
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

-- To roll back, uncomment and run manually with the pre-migration
-- export to restore each row's pinned model strings. No automatic
-- down-migration: rolling back deterministically would require
-- replaying the export.
