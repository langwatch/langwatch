-- Which run wrote a workbench version, when a run wrote it.
--
-- A run writes its cells into the workbench state, which advances the counter.
-- The page that started the run then reads its own bump as somebody else's
-- write: its next save is refused, and the reader is asked to reload over
-- unsaved edits the run had nothing to do with. Named here, the refusal can
-- tell the page the version is its own, and the page adopts it instead.
--
-- The column is nullable and gets no backfill: every row written before this
-- migration was written by a person or by the API, not by a run, which is
-- exactly what NULL says.
ALTER TABLE "ExperimentVersion" ADD COLUMN     "runId" TEXT;

-- To roll back, uncomment and run manually. The column is the only record of
-- which run wrote a version, so a drop makes every page treat its own run's
-- write as a stranger's again:
--
-- ALTER TABLE "ExperimentVersion" DROP COLUMN "runId";
