-- Optional adversarial (red-team) configuration on a scenario. A null
-- redTeamStrategy means a standard scenario, so every existing row keeps its
-- current behaviour without a backfill.
--
-- IRREVERSIBLE: dropping these columns would discard every configured attack
-- objective, turn budget and tuning value. There is deliberately no down step.
-- To roll back, uncomment and run manually, accepting that data loss:
--
--   ALTER TABLE "Scenario"
--     DROP COLUMN "redTeamConfig",
--     DROP COLUMN "redTeamStrategy",
--     DROP COLUMN "redTeamTarget",
--     DROP COLUMN "redTeamTotalTurns";

-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN     "redTeamConfig" JSONB,
ADD COLUMN     "redTeamStrategy" TEXT,
ADD COLUMN     "redTeamTarget" TEXT,
ADD COLUMN     "redTeamTotalTurns" INTEGER;
