-- IRREVERSIBLE: adds a nullable column; migrations never drop one, a drop is an operator step.
-- The trace origins a Dashboards board leaves out of every widget, as a JSON list of strings;
-- null keeps the board's default (Langy's out, none in a personal project). Written by the
-- dashboard module. Spec: modules/dashboard/specs/dashboards-v2.feature AC200
ALTER TABLE "DashboardsV2" ADD COLUMN IF NOT EXISTS "excludedOrigins" JSONB;
