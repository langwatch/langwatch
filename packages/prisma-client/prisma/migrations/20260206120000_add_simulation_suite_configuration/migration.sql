-- CreateTable
CREATE TABLE "SimulationSuite" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "scenarioIds" TEXT[],
    "targets" JSONB NOT NULL,
    "repeatCount" INTEGER NOT NULL DEFAULT 1,
    "labels" TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationSuite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimulationSuite_projectId_idx" ON "SimulationSuite"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationSuite_projectId_slug_key" ON "SimulationSuite"("projectId", "slug");
