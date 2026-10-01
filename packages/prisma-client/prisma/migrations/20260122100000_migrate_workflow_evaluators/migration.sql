-- Migrate existing published workflow evaluators to have corresponding Evaluator records
-- This creates an Evaluator for each Workflow where isEvaluator = true and no Evaluator exists yet
--
-- This migration is idempotent - it only creates evaluators for workflows that don't already have one

-- Create evaluators from existing published workflow evaluators
-- Use workflow ID as suffix in evaluator ID to ensure reliable matching
INSERT INTO "Evaluator" ("id", "projectId", "name", "slug", "type", "config", "workflowId", "createdAt", "updatedAt")
SELECT
  CONCAT('evaluator_from_wf_', w."id") as "id",
  w."projectId",
  w."name",
  CONCAT(
    -- Slugify the name: lowercase, replace non-alphanumeric with hyphens, trim hyphens
    TRIM(BOTH '-' FROM regexp_replace(lower(w."name"), '[^a-z0-9]+', '-', 'g')),
    '-',
    -- Add random 5-char suffix for uniqueness
    substr(md5(random()::text || w."id"), 1, 5)
  ) as "slug",
  'workflow' as "type",
  '{}'::jsonb as "config",
  w."id" as "workflowId",
  w."createdAt",
  w."updatedAt"
FROM "Workflow" w
WHERE w."isEvaluator" = true
  AND w."archivedAt" IS NULL
  -- Only create if no evaluator already exists for this workflow
  AND NOT EXISTS (
    SELECT 1 FROM "Evaluator" e
    WHERE e."workflowId" = w."id"
      AND e."archivedAt" IS NULL
  );
