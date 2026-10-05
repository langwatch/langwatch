-- Issue #6411: SDK-driven experiments (no Optimization Studio workflow) had no
-- way to record which dataset they ran against, so the experiments list
-- always showed "-" in the Dataset column for them. A workflow-backed
-- experiment still reads its dataset from the workflow DSL's entry node; this
-- column is the fallback for an experiment with no workflow at all.
-- AlterTable
ALTER TABLE "Experiment" ADD COLUMN "datasetId" TEXT;

-- CreateIndex
CREATE INDEX "Experiment_datasetId_idx" ON "Experiment"("datasetId");

-- IRREVERSIBLE: Prisma migrations are forward-only; there is no Down step to
-- run automatically. The commands below are commentary, not an executable
-- rollback. They are safe to run manually anyway: the column is additive-only
-- and unread by any code that predates it, so running them loses only the
-- dataset association on SDK-driven experiments, nothing else.
--   DROP INDEX "Experiment_datasetId_idx";
--   ALTER TABLE "Experiment" DROP COLUMN "datasetId";
