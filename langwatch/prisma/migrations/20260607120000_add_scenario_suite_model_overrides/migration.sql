-- Per-scenario and per-run-plan user-simulator / judge model overrides.
-- Additive and nullable: existing rows keep resolving the project's
-- scenarios.user_simulator / scenarios.judge DEFAULT-role models at run time.

-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN     "simulatorModel" TEXT,
ADD COLUMN     "judgeModel" TEXT;

-- AlterTable
ALTER TABLE "SimulationSuite" ADD COLUMN     "simulatorModel" TEXT,
ADD COLUMN     "judgeModel" TEXT;
