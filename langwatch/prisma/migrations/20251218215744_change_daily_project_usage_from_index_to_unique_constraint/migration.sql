/*
  Warnings:

  - A unique constraint covering the columns `[projectId,date]` on the table `ProjectDailyUsage` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[projectId,aggregateId,date]` on the table `ProjectDailyUsageProcessedAggregates` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "ProjectDailyUsage_projectId_date_idx";

-- DropIndex
DROP INDEX "ProjectDailyUsageProcessedAggregates_projectId_aggregateId__idx";

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDailyUsage_projectId_date_key" ON "ProjectDailyUsage"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDailyUsageProcessedAggregates_projectId_aggregateId__key" ON "ProjectDailyUsageProcessedAggregates"("projectId", "aggregateId", "date");
