-- Connected self-hosted (ADR-141, amendment 2026-10-01): which hosted services
-- an organization has switched ON.
--
-- Hosted services are opt-in per organization. A service the license names
-- stays off until an administrator lists it here, so no existing organization
-- is backfilled: every one starts with nothing enabled.
--
-- connectServicesDisabled is no longer read. It stays in place so a rolling
-- deploy does not break the previous release, and is dropped in a later
-- migration.
--
-- Additive only: one array column defaulting to empty. To roll back, drop the
-- column manually:
-- ALTER TABLE "Organization" DROP COLUMN "connectServicesEnabled";

ALTER TABLE "Organization" ADD COLUMN "connectServicesEnabled" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
