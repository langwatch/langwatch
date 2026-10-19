-- The stored vocabulary matches the product vocabulary.
--
-- A group of scenarios is a TEST SUITE, and what you run is a RUN PLAN. The
-- data used three other words for them: the column "Scenario"."folderId", the
-- "SimulationSuite"."kind" values 'folder' and 'custom', and the scope modes
-- 'folders' and 'cases'. Every reader now says test suite, run plan and
-- scenario, so the data says the same.
--
-- What changes:
--   * "Scenario"."folderId" becomes "Scenario"."testSuiteId", and its index
--     follows the column name.
--   * "SimulationSuite"."kind" 'folder' becomes 'test_suite' and 'custom'
--     becomes 'run_plan'. The column default follows.
--   * "SimulationSuite"."scope" mode 'folders' becomes 'test_suites' with
--     "testSuiteIds" in place of "folderIds", and mode 'cases' becomes
--     'scenarios'.
--
-- A NULL scope is left as it is: it reads as the hand-picked list, which is
-- the 'scenarios' mode, and writing the value in adds nothing.
--
-- The deprecated /api/suites family keeps 'custom' and 'folder' on its wire
-- and maps both ways at its boundary, so no integrator sees this change.
--
-- IRREVERSIBLE: there is no down migration.
--
-- The rename carries every row forward with the value it held, so nothing is
-- lost. A revert is the same statements with the names swapped, which is a
-- new migration rather than a rollback of this one.

-- Step 1: the scenario column and its index.
ALTER TABLE "Scenario" RENAME COLUMN "folderId" TO "testSuiteId";

ALTER INDEX "Scenario_projectId_folderId_idx" RENAME TO "Scenario_projectId_testSuiteId_idx";

-- Step 2: the suite kinds and the column default.
UPDATE "SimulationSuite" SET "kind" = 'test_suite' WHERE "kind" = 'folder';

UPDATE "SimulationSuite" SET "kind" = 'run_plan' WHERE "kind" = 'custom';

ALTER TABLE "SimulationSuite" ALTER COLUMN "kind" SET DEFAULT 'run_plan';

-- Step 3: the scope modes.
--
-- A 'folders' scope carries its own list, so the row is rebuilt with both the
-- mode and the list key renamed. A list key that is absent reads as an empty
-- list, which is what an empty pick already meant.
UPDATE "SimulationSuite"
SET "scope" = jsonb_build_object(
  'mode', 'test_suites',
  'testSuiteIds', COALESCE("scope" -> 'folderIds', '[]'::jsonb)
)
WHERE "scope" ->> 'mode' = 'folders';

UPDATE "SimulationSuite"
SET "scope" = jsonb_set("scope", '{mode}', '"scenarios"'::jsonb)
WHERE "scope" ->> 'mode' = 'cases';
