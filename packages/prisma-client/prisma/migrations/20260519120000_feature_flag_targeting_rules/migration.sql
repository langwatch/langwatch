-- Add a JSON column for per-flag targeting rules. Rules are evaluated
-- in order; the first match decides; missing/empty rules fall through
-- to the row's existing `enabled` boolean. Shape is owned by
-- src/server/featureFlag/rules.ts so it can grow (percentage rollouts,
-- email-domain matches, ...) without another migration.

ALTER TABLE "FeatureFlag" ADD COLUMN "rules" JSONB;
