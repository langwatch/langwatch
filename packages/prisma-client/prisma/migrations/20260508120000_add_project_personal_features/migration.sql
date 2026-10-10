-- Adds the per-feature unlock flags for personal projects.
--
-- Empty JSON object is the default — service layer treats missing
-- keys as `false`, so existing rows require no backfill. Bundle is a
-- UI/nav predicate only; the underlying tRPC routers stay open so
-- admin tooling + offline migration scripts can still operate on the
-- data when the bundle is off.
ALTER TABLE "Project" ADD COLUMN "personalFeatures" JSONB NOT NULL DEFAULT '{}'::jsonb;
