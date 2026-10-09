-- The organization a seat change belongs to, so a `not_onboarded` row with no
-- account names its customer (20261006170511). Rows written before it name only
-- their account: the background step billing:fill-seat-change-organizations
-- fills them from the account, never an UPDATE here.
ALTER TABLE "ConnectedSeatChange" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "ConnectedSeatChange_organizationId_idx" ON "ConnectedSeatChange" ("organizationId");
-- A failed concurrent build leaves an invalid index this skips: check pg_index.indisvalid, DROP INDEX CONCURRENTLY, retry.
CREATE INDEX IF NOT EXISTS "ConnectedSeatChange_organizationId_idx" ON "ConnectedSeatChange"("organizationId");
