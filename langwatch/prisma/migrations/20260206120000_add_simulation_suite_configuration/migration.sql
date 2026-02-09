-- CreateTable
CREATE TABLE "SimulationSuiteConfiguration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scenarioIds" TEXT[],
    "targets" JSONB NOT NULL,
    "repeatCount" INTEGER NOT NULL DEFAULT 1,
    "labels" TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationSuiteConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulationSuiteConfiguration_projectId_idx" ON "SimulationSuiteConfiguration"("projectId");
