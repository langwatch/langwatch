-- DropIndex
DROP INDEX "LlmPromptConfig_organizationId_idx";

-- CreateIndex
CREATE INDEX "LlmPromptConfig_organizationId_scope_idx" ON "LlmPromptConfig"("organizationId", "scope");

-- Down (manual rollback; uncomment and run). Both steps only move an index, so
-- no row data is lost. The prompt list gets slower again on the organization
-- scope read, because the wider index no longer covers it:
-- DROP INDEX "LlmPromptConfig_organizationId_scope_idx";
-- CREATE INDEX "LlmPromptConfig_organizationId_idx" ON "LlmPromptConfig"("organizationId");
