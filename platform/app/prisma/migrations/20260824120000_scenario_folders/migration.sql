-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN     "folderId" TEXT;

-- AlterTable
ALTER TABLE "SimulationSuite" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'custom';

-- CreateIndex
CREATE INDEX "Scenario_projectId_folderId_idx" ON "Scenario"("projectId", "folderId");

-- CreateIndex
CREATE INDEX "SimulationSuite_projectId_kind_idx" ON "SimulationSuite"("projectId", "kind");
