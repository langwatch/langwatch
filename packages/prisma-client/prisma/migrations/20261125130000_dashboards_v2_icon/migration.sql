-- IRREVERSIBLE: adds one nullable column; migrations never drop one, a drop is an operator step.
-- A board's Lucide icon name, validated against the dashboard contract's allow-list on write.
-- Null draws the default glyph, so existing boards need no backfill and no table rewrite.
-- Written by the dashboard module. Spec: modules/dashboard/specs/dashboard-icons.feature
ALTER TABLE "DashboardsV2" ADD COLUMN IF NOT EXISTS "icon" TEXT;
