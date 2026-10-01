-- A test suite holds no execution settings.
--
-- A folder-kind "SimulationSuite" used to carry "targets", "repeatCount",
-- "simulatorModel" and "judgeModel" as the last-used settings of that suite,
-- read by a caller that addressed the suite by its id and sent none of its
-- own. Those settings now travel with each run and are written onto the run
-- plan the run resolves, so the copy on the folder row is a second answer to
-- what a run uses with nothing saying which one the next run reads. This
-- migration clears it.
--
-- Custom rows are left alone: a custom row IS a run plan, and its stored
-- configuration is what a run of it executes.
--
-- The columns stay on the table, because custom rows use all four. What
-- changes is the rule for folder rows, which server/suites/suite.service.ts
-- enforces on every write from here on (assertFolderUpdate).
--
-- IRREVERSIBLE: there is no down migration.
--
-- The cleared values are the settings some past run used, and the run plans
-- written since hold the settings every run since then used, so nothing
-- readable is lost. There is no record of what each folder row held before
-- this ran, so a revert cannot restore it.

UPDATE "SimulationSuite"
SET "targets" = '[]'::jsonb, "repeatCount" = 1, "simulatorModel" = NULL, "judgeModel" = NULL
WHERE "kind" = 'folder';
