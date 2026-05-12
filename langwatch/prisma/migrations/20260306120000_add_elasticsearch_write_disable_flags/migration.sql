-- AlterTable
ALTER TABLE "Project" ADD COLUMN "disableElasticSearchTraceWriting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "disableElasticSearchEvaluationWriting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "disableElasticSearchSimulationWriting" BOOLEAN NOT NULL DEFAULT false;
