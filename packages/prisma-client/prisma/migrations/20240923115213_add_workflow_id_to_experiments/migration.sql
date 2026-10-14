-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN     "workflowId" TEXT;

-- CreateIndex
CREATE INDEX "Experiment_workflowId_idx" ON "Experiment"("workflowId");
