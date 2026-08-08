-- CreateEnum
CREATE TYPE "FanOutSeedType" AS ENUM ('SCENARIO_RUN', 'FREE_TEXT');

-- CreateEnum
CREATE TYPE "FanOutBatchStatus" AS ENUM ('GENERATING', 'READY_FOR_REVIEW', 'DISPATCHING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FanOutVariantStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "FanOutBatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "seedType" "FanOutSeedType" NOT NULL,
    "seedScenarioId" TEXT,
    "seedScenarioRunId" TEXT,
    "seedDescription" TEXT,
    "seedCriteria" TEXT[],
    "seedTarget" JSONB NOT NULL,
    "status" "FanOutBatchStatus" NOT NULL DEFAULT 'GENERATING',
    "batchRunId" TEXT,
    "scenarioSetId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FanOutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FanOutVariant" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "lens" TEXT NOT NULL,
    "rationale" TEXT,
    "status" "FanOutVariantStatus" NOT NULL DEFAULT 'PENDING',
    "scenarioRunId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FanOutVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FanOutBatch_projectId_status_idx" ON "FanOutBatch"("projectId", "status");

-- CreateIndex
CREATE INDEX "FanOutVariant_batchId_idx" ON "FanOutVariant"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "FanOutVariant_batchId_scenarioId_key" ON "FanOutVariant"("batchId", "scenarioId");

-- Down (manual): drops every fan-out batch and its review decisions. The
-- generated Scenario rows survive, since they are ordinary library scenarios.
--   DROP TABLE "FanOutVariant";
--   DROP TABLE "FanOutBatch";
--   DROP TYPE "FanOutVariantStatus";
--   DROP TYPE "FanOutBatchStatus";
--   DROP TYPE "FanOutSeedType";
