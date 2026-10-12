-- Issue #6411: SDK-driven experiments (no Optimization Studio workflow) had no
-- way to record which dataset they ran against, so the experiments list
-- always showed "-" in the Dataset column for them. A workflow-backed
-- experiment still reads its dataset from the workflow DSL's entry node; this
-- column is the fallback for an experiment with no workflow at all.
--
-- LOCKING NOTE: plain `CREATE INDEX` locks "Experiment" for the length of the
-- build, so experiment writes (init, reports) wait. Experiments are created
-- far less often than, say, traces, and this runs during deploy, so the pause
-- is brief. `CONCURRENTLY` would avoid the lock but cannot run inside a
-- transaction, which the Prisma migration runner requires (see the identical
-- tradeoff in 20260804120000_dataset_record_project_dataset_index and
-- 20260814120002_llm_prompt_config_org_scope_index).
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
