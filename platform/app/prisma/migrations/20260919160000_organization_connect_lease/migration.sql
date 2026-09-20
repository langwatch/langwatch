-- IRREVERSIBLE: no down step. Dropping connectLease discards the signed lease
-- an install is running on, so its seat allowance stops until the next sync
-- mints another. Rolling the code back is safe: the column stays unread.
--
-- Connected self-hosted (ADR-139, section 6): what a license sync leaves on the
-- install.
--
-- connectLease holds the lease LangWatch signed, stored only after the install
-- verified it for its own license and its own instance. The allowance and the
-- dates that withdraw it live inside the signed payload, so nothing here
-- decides how long the allowance lasts.
--
-- Additive only: three nullable columns. An install that never syncs keeps
-- them null and stays on the plain licensed seat count.

ALTER TABLE "Organization" ADD COLUMN     "connectLease" JSONB,
ADD COLUMN     "connectLastSyncAt" TIMESTAMP(3),
ADD COLUMN     "connectLastSyncError" TEXT;
