-- IRREVERSIBLE: there is no down step. The columns are additive and hold
-- which template and version a suite came from; a rollback leaves them in place for the previous release to ignore.
ALTER TABLE "SimulationSuite" ADD COLUMN IF NOT EXISTS "templateId" TEXT, ADD COLUMN IF NOT EXISTS "templateVersion" INTEGER;
