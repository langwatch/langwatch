-- Dashboards v1 (modules/dashboard/specs/dashboards-v1.feature).
-- Additive with defaults only: the image still serving never names these columns.
-- One statement, so the table's readers queue behind one lock wait and not two.
ALTER TABLE "Dashboard"
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "createdById" TEXT;
