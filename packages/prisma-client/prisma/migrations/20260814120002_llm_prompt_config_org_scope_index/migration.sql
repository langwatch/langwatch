-- The prompt list reads organization-scoped prompts with
-- `WHERE "organizationId" = $1 AND "scope" = 'ORGANIZATION'`. The single-column
-- index made the planner read every prompt of the organization and then drop
-- the project-scoped ones. The composite serves the whole predicate, and it
-- replaces the single-column index because it has the same leading column.
--
-- LOCKING NOTE: plain `DROP INDEX` and `CREATE INDEX` lock "LlmPromptConfig"
-- for the length of the build, so prompt writes wait. The table is small and
-- this runs during deploy, so the pause is short. The `CONCURRENTLY` forms
-- would avoid the lock but cannot run inside a transaction, which the Prisma
-- migration runner requires.

-- DropIndex
DROP INDEX "LlmPromptConfig_organizationId_idx";

-- CreateIndex
CREATE INDEX "LlmPromptConfig_organizationId_scope_idx" ON "LlmPromptConfig"("organizationId", "scope");

-- Down (manual rollback; uncomment and run). Both steps only move an index, so
-- no row data is lost. The prompt list gets slower again on the organization
-- scope read, because the wider index no longer covers it:
-- DROP INDEX "LlmPromptConfig_organizationId_scope_idx";
-- CREATE INDEX "LlmPromptConfig_organizationId_idx" ON "LlmPromptConfig"("organizationId");
