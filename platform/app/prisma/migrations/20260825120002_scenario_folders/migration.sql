-- Test suites: a scenario can be filed under a suite, and a suite row says
-- whether it is a folder of cases or a hand-assembled run plan.
--
-- `Scenario.folderId` is nullable because an unfiled case is the normal state,
-- and every project starts with all of its cases unfiled. `SimulationSuite.kind`
-- defaults to 'custom' so every row that existed before this migration keeps
-- reading as the run plan it already is; only rows written by the folder code
-- carry 'folder'.
ALTER TABLE "Scenario" ADD COLUMN     "folderId" TEXT;

ALTER TABLE "SimulationSuite" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'custom';

-- Supports "the cases of THIS suite in THIS project", the read the cases table
-- issues on every render, so it does not scan the project's whole case list.
CREATE INDEX "Scenario_projectId_folderId_idx" ON "Scenario"("projectId", "folderId");

-- Supports "the folders of THIS project", which the suite rail and the case
-- form both read separately from the run plans.
CREATE INDEX "SimulationSuite_projectId_kind_idx" ON "SimulationSuite"("projectId", "kind");

-- IRREVERSIBLE: dropping "Scenario"."folderId" destroys folder membership.
--
-- The column IS the membership. It is the only record of which suite a case
-- belongs to, so a DROP COLUMN does not return the database to its prior
-- state, it deletes data that was never anywhere else. `SimulationSuite`
-- carries a `scenarioIds` list, but that list is a projection rebuilt from
-- `folderId`, so it cannot restore what the drop removed.
--
-- To reverse this deliberately, the membership must be dealt with FIRST, while
-- the column can still be read: exported, or written back into a form the v1
-- pages understand. That is a data decision, not a schema one, so it is not
-- scripted here. Repair goes forward, in a new migration.
--
-- Dropping "SimulationSuite"."kind" and both indexes is safe and independent:
--   DROP INDEX "SimulationSuite_projectId_kind_idx";
--   DROP INDEX "Scenario_projectId_folderId_idx";
--   ALTER TABLE "SimulationSuite" DROP COLUMN "kind";
-- Every suite then reads as a run plan again, which is what it was before.
