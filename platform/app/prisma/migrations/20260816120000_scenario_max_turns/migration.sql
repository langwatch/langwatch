-- Per-scenario cap on conversation turns.
--
-- Runs triggered from the UI always used the scenario SDK default of 10
-- turns because nothing carried a cap. This column stores an optional
-- per-scenario value. NULL means "use the SDK default", which is what every
-- existing row already does, so there is no backfill.
-- See specs/scenarios/scenario-max-turns.feature.

-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN "maxTurns" INTEGER;

-- Down (manual): reverses this migration; run only to roll back.
--   ALTER TABLE "Scenario" DROP COLUMN "maxTurns";
