-- Lift legacy `analytics.topic_clustering_llm` per-feature override into
-- the FAST role on the same ModelDefaultConfig. The prior backfill in
-- 20260518010000_cascading_default_models wrote Project.topicClusteringModel
-- into the per-feature key instead of the FAST role, which meant new
-- projects landed with an empty FAST tier and a redundant Topic-clustering
-- chip carrying what should have been the FAST role's value.
--
-- Two cases:
--   1. FAST is unset on the config        → move topic_clustering_llm into FAST
--   2. FAST is already set on the config  → drop topic_clustering_llm
--      (FAST already wins the resolver's role-level lookup; the override
--       is dead weight and would re-introduce divergence on next edit)
--
-- In both cases the per-feature key is removed afterwards so the resolver
-- falls cleanly back to the role-level value.

-- Case 1: lift into FAST when FAST is missing.
UPDATE "ModelDefaultConfig"
SET
    config = jsonb_set(
        config,
        '{FAST}',
        config -> 'analytics.topic_clustering_llm'
    ) - 'analytics.topic_clustering_llm'
WHERE
    config ? 'analytics.topic_clustering_llm'
    AND NOT (config ? 'FAST');

-- Case 2: drop the per-feature key when FAST is already set.
UPDATE "ModelDefaultConfig"
SET
    config = config - 'analytics.topic_clustering_llm'
WHERE
    config ? 'analytics.topic_clustering_llm'
    AND (config ? 'FAST');

-- No down migration: this is a one-way data lift. To roll back, restore
-- the per-feature key from a pre-migration export of "ModelDefaultConfig".
