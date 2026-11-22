-- IRREVERSIBLE: adds nullable columns; migrations never drop one, a drop is an operator step.
-- When and why a monitor paused itself because its evaluations mostly errored; written and
-- cleared by the monitor module. Spec: modules/monitor/specs/monitor-auto-pause.feature
ALTER TABLE "Monitor" ADD COLUMN IF NOT EXISTS "autoPausedAt" TIMESTAMP(3), ADD COLUMN IF NOT EXISTS "autoPausedReason" TEXT;
