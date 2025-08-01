-- Add referenceId field for namespaced references
-- referenceId: Unique identifier in format team/project/prompt
-- NULL = draft, NOT NULL = finalized
ALTER TABLE "LlmPromptConfig" ADD COLUMN "referenceId" TEXT;

-- Add unique constraint for referenceId scoped by projectId (only when not null)
-- This ensures each referenceId is unique within a project
CREATE UNIQUE INDEX "LlmPromptConfig_projectId_referenceId_key" 
ON "LlmPromptConfig"("projectId", "referenceId") 
WHERE "referenceId" IS NOT NULL;

-- Add index for performance on referenceId lookups
CREATE INDEX "LlmPromptConfig_referenceId_idx" ON "LlmPromptConfig"("referenceId");

-- Remove auto-increment from version column to allow manual version control
ALTER TABLE "LlmPromptConfigVersion" ALTER COLUMN "version" DROP DEFAULT;
DROP SEQUENCE "LlmPromptConfigVersion_version_seq";