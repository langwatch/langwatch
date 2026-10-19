
-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "copiedFromWorkflowId" TEXT;

-- CreateIndex
CREATE INDEX "Workflow_copiedFromWorkflowId_idx" ON "Workflow"("copiedFromWorkflowId");

-- AlterTable
ALTER TABLE "LlmPromptConfig" ADD COLUMN     "copiedFromPromptId" TEXT;

-- CreateIndex
CREATE INDEX "LlmPromptConfig_copiedFromPromptId_idx" ON "LlmPromptConfig"("copiedFromPromptId");
