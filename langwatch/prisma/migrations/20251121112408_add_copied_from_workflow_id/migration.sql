
-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "copiedFromWorkflowId" TEXT;

-- CreateIndex
CREATE INDEX "Workflow_copiedFromWorkflowId_idx" ON "Workflow"("copiedFromWorkflowId");
