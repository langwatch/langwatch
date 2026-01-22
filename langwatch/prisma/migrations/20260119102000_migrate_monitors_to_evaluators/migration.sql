-- Migrate existing monitors to use evaluator references
-- This creates an Evaluator for each existing Monitor and links them together

-- Step 1: Create evaluators from existing monitors (one evaluator per monitor)
-- Use monitor ID as suffix in evaluator ID to ensure reliable matching
INSERT INTO "Evaluator" ("id", "projectId", "name", "slug", "type", "config", "createdAt", "updatedAt")
SELECT
  CONCAT('evaluator_from_', m."id") as "id",
  m."projectId",
  m."name",
  CONCAT(
    TRIM(BOTH '-' FROM regexp_replace(lower(m."name"), '[^a-z0-9]+', '-', 'g')),
    '-',
    substr(md5(random()::text || m."id"), 1, 5)
  ) as "slug",
  'evaluator' as "type",
  jsonb_build_object(
    'evaluatorType', m."checkType",
    'settings', m."parameters"
  ) as "config",
  m."createdAt",
  m."updatedAt"
FROM "Monitor" m
WHERE m."evaluatorId" IS NULL;

-- Step 2: Update monitors with their corresponding evaluatorId
-- Match using the deterministic ID pattern we created
UPDATE "Monitor" m
SET "evaluatorId" = CONCAT('evaluator_from_', m."id")
WHERE m."evaluatorId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "Evaluator" e
    WHERE e."id" = CONCAT('evaluator_from_', m."id")
  );
