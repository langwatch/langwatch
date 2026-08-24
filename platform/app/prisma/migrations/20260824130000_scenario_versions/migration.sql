-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ScenarioVersion" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "authorId" TEXT,
    "authorLabel" TEXT NOT NULL,
    "changeDescription" TEXT,
    "snapshot" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScenarioVersion_projectId_scenarioId_version_idx" ON "ScenarioVersion"("projectId", "scenarioId", "version");

-- CreateIndex
CREATE INDEX "ScenarioVersion_createdAt_idx" ON "ScenarioVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioVersion_scenarioId_version_key" ON "ScenarioVersion"("scenarioId", "version");
