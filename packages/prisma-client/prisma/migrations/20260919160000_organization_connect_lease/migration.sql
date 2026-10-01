-- Connected self-hosted (ADR-141, section 6): what a license sync leaves on the
-- install.
--
-- connectLastSyncAt is when the last sync succeeded and connectLastSyncError
-- the code of the failure the last one ended on, cleared on the next success.
-- Settings, Connect renders the copy for it.
--
-- Additive only: two nullable columns. An install that never syncs keeps them
-- null.

ALTER TABLE "Organization" ADD COLUMN     "connectLastSyncAt" TIMESTAMP(3),
ADD COLUMN     "connectLastSyncError" TEXT;
