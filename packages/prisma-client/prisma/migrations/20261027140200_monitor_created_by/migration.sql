-- IRREVERSIBLE: adds nullable columns; migrations never drop one, a drop is an operator step.
-- The evaluator deploy label a monitor runs (null runs the latest) and who created and last changed
-- the monitor, written by the monitor module.
-- Specs: modules/monitor/specs/monitor-created-by.feature, modules/evaluator/specs/evaluator-versioning.feature
ALTER TABLE "Monitor" ADD COLUMN IF NOT EXISTS "evaluatorLabel" TEXT, ADD COLUMN IF NOT EXISTS "createdById" TEXT, ADD COLUMN IF NOT EXISTS "updatedById" TEXT;
