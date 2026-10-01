-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "currentVersionId" TEXT;

-- CreateIndex
CREATE INDEX "Workflow_currentVersionId_idx" ON "Workflow"("currentVersionId");
