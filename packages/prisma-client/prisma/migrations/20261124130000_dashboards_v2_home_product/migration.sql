-- IRREVERSIBLE: adds one column; migrations never drop one, a drop is an operator step.
-- The product whose sidebar lists a Dashboards board (ADR-002, decision 8). The constant default
-- homes every existing board in LLM Ops, where it lists today, with no table rewrite or backfill.
-- Written by the dashboard module. Spec: modules/dashboard/specs/dashboards-organization-area.feature
ALTER TABLE "DashboardsV2" ADD COLUMN IF NOT EXISTS "homeProduct" TEXT NOT NULL DEFAULT 'llm-ops';
