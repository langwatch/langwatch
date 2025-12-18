/*
  Warnings:

  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "metadata" SET NOT NULL;

-- CreateTable
CREATE TABLE "ProjectDailyUsage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "traceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDailyUsageProcessedAggregates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDailyUsageProcessedAggregates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDailyUsage_projectId_date_idx" ON "ProjectDailyUsage"("projectId", "date");

-- CreateIndex
CREATE INDEX "ProjectDailyUsageProcessedAggregates_projectId_aggregateId__idx" ON "ProjectDailyUsageProcessedAggregates"("projectId", "aggregateId", "date");
