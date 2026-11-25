-- AlterTable: Remove feature flags that are now always true
-- ClickHouse is the sole data store; ElasticSearch writes are fully disabled.
ALTER TABLE "Project" DROP COLUMN "featureEventSourcingTraceIngestion";
ALTER TABLE "Project" DROP COLUMN "featureEventSourcingSimulationIngestion";
ALTER TABLE "Project" DROP COLUMN "featureEventSourcingEvaluationIngestion";
ALTER TABLE "Project" DROP COLUMN "featureClickHouseDataSourceTraces";
ALTER TABLE "Project" DROP COLUMN "featureClickHouseDataSourceSimulations";
ALTER TABLE "Project" DROP COLUMN "featureClickHouseDataSourceEvaluations";
ALTER TABLE "Project" DROP COLUMN "disableElasticSearchTraceWriting";
ALTER TABLE "Project" DROP COLUMN "disableElasticSearchEvaluationWriting";
ALTER TABLE "Project" DROP COLUMN "disableElasticSearchSimulationWriting";
