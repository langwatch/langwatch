-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Experiment_projectId_archivedAt_idx" ON "Experiment"("projectId", "archivedAt");
