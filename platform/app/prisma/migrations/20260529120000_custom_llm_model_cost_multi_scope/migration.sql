-- Multi-scope custom model costs (ADR-021).
--
-- CustomLLMModelCost moves from project-only to a single-scope-per-row
-- inline shape: an organizationId anchor plus (scopeType, scopeId). Existing
-- rows become PROJECT-tier scopes anchored to their project's organization.
-- The legacy projectId column is kept nullable for one release of read
-- compatibility.

CREATE TYPE "CustomLLMModelCostScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT');

-- Add the new columns nullable so the backfill can populate them.
ALTER TABLE "CustomLLMModelCost"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "scopeType" "CustomLLMModelCostScopeType" NOT NULL DEFAULT 'PROJECT',
  ADD COLUMN "scopeId" TEXT;

-- Backfill: anchor each existing row to its project's organization and turn
-- it into a PROJECT-tier scope pointing at that project.
UPDATE "CustomLLMModelCost" AS c
SET
  "organizationId" = t."organizationId",
  "scopeType" = 'PROJECT',
  "scopeId" = c."projectId"
FROM "Project" AS p
JOIN "Team" AS t ON p."teamId" = t."id"
WHERE c."projectId" = p."id";

-- Any row whose project could not be resolved (orphan) cannot be anchored to
-- an organization and must not silently survive without tenancy. Remove it.
DELETE FROM "CustomLLMModelCost" WHERE "organizationId" IS NULL OR "scopeId" IS NULL;

-- Now that every surviving row is anchored, enforce the invariants.
ALTER TABLE "CustomLLMModelCost"
  ALTER COLUMN "organizationId" SET NOT NULL,
  ALTER COLUMN "scopeId" SET NOT NULL,
  ALTER COLUMN "projectId" DROP NOT NULL;

CREATE INDEX "CustomLLMModelCost_organizationId_idx" ON "CustomLLMModelCost" ("organizationId");
CREATE INDEX "CustomLLMModelCost_scopeType_scopeId_idx" ON "CustomLLMModelCost" ("scopeType", "scopeId");

-- To roll back, uncomment and run manually:
-- DROP INDEX "CustomLLMModelCost_scopeType_scopeId_idx";
-- DROP INDEX "CustomLLMModelCost_organizationId_idx";
-- ALTER TABLE "CustomLLMModelCost" DROP COLUMN "scopeId", DROP COLUMN "scopeType", DROP COLUMN "organizationId";
-- DROP TYPE "CustomLLMModelCostScopeType";
