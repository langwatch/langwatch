-- Dashboards v1 (modules/dashboard/specs/dashboards-v1.feature, AC18/AC24/AC26).
-- Additive with defaults only: every existing board reads as organisation-wide,
-- the access it had before, and the image still serving never names these columns.
ALTER TABLE "Dashboard" ADD COLUMN "description" TEXT;
ALTER TABLE "Dashboard" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'organisation';
ALTER TABLE "Dashboard" ADD COLUMN "createdById" TEXT;
