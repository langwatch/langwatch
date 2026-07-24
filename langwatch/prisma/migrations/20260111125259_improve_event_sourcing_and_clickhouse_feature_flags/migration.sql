/*
  Warnings:

  - You are about to drop the column `featureClickHouse` on the `Project` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Project" DROP COLUMN "featureClickHouse",
ADD COLUMN     "featureClickHouseDataSourceEvaluations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featureClickHouseDataSourceSimulations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featureClickHouseDataSourceTraces" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featureEventSourcingEvaluationIngestion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featureEventSourcingSimulationIngestion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featureEventSourcingTraceIngestion" BOOLEAN NOT NULL DEFAULT false;
