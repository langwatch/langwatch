-- Drop the legacy default-model scalar columns from Organization,
-- Team, and Project. The CSS-cascade ModelDefaultConfig table
-- (introduced in 20260516010000_replace_model_default_with_config)
-- is now the single source of truth, and the data lift in that
-- migration already packed every non-null legacy value into a
-- matching ModelDefaultConfig row at the right scope.
--
-- Nothing in the application reads these columns anymore: the
-- resolver, embeddings.ts, topicClustering, scenarios prefetcher
-- and runner, prompt-config repository, the workflow selector
-- drawers, the Hono /evaluators v1 route, and every settings page
-- consumer all go through `resolveModelForFeature` or the
-- `modelProvider.getResolvedDefault` tRPC query.
--
-- This completes the directive that drove the cascade: no global
-- system fallback, no legacy compat tier, no implicit fallback to
-- the openai/gpt-4o-mini constant on fresh accounts. If a project
-- has no role configured at any scope, AI features throw
-- ModelNotConfiguredError and the user sees a sticky toast.

ALTER TABLE "Organization"
    DROP COLUMN IF EXISTS "defaultModel",
    DROP COLUMN IF EXISTS "topicClusteringModel",
    DROP COLUMN IF EXISTS "embeddingsModel";

ALTER TABLE "Team"
    DROP COLUMN IF EXISTS "defaultModel",
    DROP COLUMN IF EXISTS "topicClusteringModel",
    DROP COLUMN IF EXISTS "embeddingsModel";

ALTER TABLE "Project"
    DROP COLUMN IF EXISTS "defaultModel",
    DROP COLUMN IF EXISTS "topicClusteringModel",
    DROP COLUMN IF EXISTS "embeddingsModel";
