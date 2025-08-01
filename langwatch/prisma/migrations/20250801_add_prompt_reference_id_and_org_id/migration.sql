-- Add referenceId field for namespaced references
-- referenceId: Globally unique identifier in format team/project/prompt
ALTER TABLE "LlmPromptConfig" ADD COLUMN "referenceId" TEXT;

-- Add organizationId field for multi-tenancy
-- This will be populated from the project's team's organizationId
ALTER TABLE "LlmPromptConfig" ADD COLUMN "organizationId" TEXT;

-- Add unique constraint for referenceId (globally unique when not null)
-- This ensures each referenceId is unique across the entire system
CREATE UNIQUE INDEX "LlmPromptConfig_referenceId_key" 
ON "LlmPromptConfig"("referenceId") 
WHERE "referenceId" IS NOT NULL;

-- Add index for organizationId lookups
CREATE INDEX "LlmPromptConfig_organizationId_idx" ON "LlmPromptConfig"("organizationId");

-- Remove auto-increment from version column to allow manual version control
ALTER TABLE "LlmPromptConfigVersion" ALTER COLUMN "version" DROP DEFAULT;
DROP SEQUENCE "LlmPromptConfigVersion_version_seq";