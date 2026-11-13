-- IRREVERSIBLE: adds two nullable columns to "SimulationSuite".
-- A rollback leaves them in place; dropping them is an operator step confirmed in Ops.
-- The judge's verdict-time trace wait per run plan (specs/scenarios/judge-trace-wait-settings.feature).
ALTER TABLE "SimulationSuite"
  ADD COLUMN IF NOT EXISTS "traceQuietPeriodMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "traceWaitTimeoutMs" INTEGER;
