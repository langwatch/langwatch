-- Per-scenario turn configuration (ADR-015).
--
-- maxTurns caps the conversation length (SDK default: 10).
-- minTurns sets a floor before the judge can end the test.
--
-- Both nullable: NULL means "use SDK default". No backfill needed —
-- every existing scenario ran with the SDK default and should continue to.

-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN "maxTurns" INTEGER;
ALTER TABLE "Scenario" ADD COLUMN "minTurns" INTEGER;

-- Down (manual — WARNING: dropping these columns permanently discards any
-- customer-configured turn limits; there is no recovery path):
--   ALTER TABLE "Scenario" DROP COLUMN "maxTurns";
--   ALTER TABLE "Scenario" DROP COLUMN "minTurns";
