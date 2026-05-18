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
--
-- Rolling-update decision (decided on this PR after the deep-review
-- raised the column-not-found-during-rollout risk):
--   The DROP runs in the same release as the code that stops reading
--   the columns. Prisma applies migrations before the new pod set
--   finishes rolling, so any pod still on the previous release would
--   crash on its next SELECT against these columns until the rollout
--   finishes. We accept that window — the prod DB has a recent
--   backup, the affected SELECT paths are cosmetic (default-model
--   prefill, settings render), and we prefer dropping the dead
--   columns in one shot over carrying a "schema clean / data dead"
--   split across two releases. If a future migration of this shape
--   hits a hotter path, defer the physical DROP to a follow-up
--   instead.

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
