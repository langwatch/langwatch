-- DropIndex
DROP INDEX "LlmPromptConfig_organizationId_idx";

-- CreateIndex
CREATE INDEX "LlmPromptConfig_organizationId_scope_idx" ON "LlmPromptConfig"("organizationId", "scope");
