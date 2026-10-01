-- What a run plan covers, as a rule rather than a fixed list.
--
-- The column is nullable and gets no backfill on purpose: a NULL scope reads
-- as { "mode": "cases" }, which runs the plan's stored "scenarioIds", so every
-- row written before this migration keeps exactly the behaviour it had.
ALTER TABLE "SimulationSuite" ADD COLUMN     "scope" JSONB;

-- To roll back, uncomment and run manually. The column holds the only record
-- of the rule a plan covers, so a drop turns every dynamic plan back into the
-- static list its cache last held:
--   ALTER TABLE "SimulationSuite" DROP COLUMN "scope";
