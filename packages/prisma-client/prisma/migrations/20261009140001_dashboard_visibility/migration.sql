-- Dashboards v1 (modules/dashboard/specs/dashboards-v1.feature).
-- Additive with defaults only: the image still serving never names these columns.
ALTER TABLE "Dashboard" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Dashboard" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
