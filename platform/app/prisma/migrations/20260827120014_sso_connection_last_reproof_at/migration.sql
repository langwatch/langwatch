-- When the re-proof sweep last LOOKED at a connection (ADR-123).
--
-- The sweep took the oldest `updatedAt` and a fixed batch, which reads as
-- round-robin and is not. A healthy re-read emits no facts, so `updatedAt`
-- never moves and the same prefix is re-read every cycle. Worse, a domain that
-- STARTS WAVERING bumps `updatedAt` to now — sorting it last, and past the
-- batch on any installation with more connections than the batch holds. The
-- one domain in its grace window was the one that stopped being re-checked,
-- so `recordDomainProofAbsent` was never called again and it never lapsed.
-- A domain that had stopped being published kept vouching for new people
-- indefinitely, which is the exact failure ADR-123 exists to close.
--
-- Additive and nullable, and nothing is backfilled: NULL sorts first, so every
-- existing connection is swept before any that has already been looked at.
-- That is the right order on the first cycle after deploy and costs one pass.
--
-- To roll back, uncomment and run manually. Dropping it returns the sweep to
-- ordering by `updatedAt`, with the gap above.
-- ALTER TABLE "SsoConnection" DROP COLUMN "lastReproofAt";

ALTER TABLE "SsoConnection" ADD COLUMN "lastReproofAt" TIMESTAMP(3);

-- The sweep's own read: the connections it may look at, oldest look first.
CREATE INDEX "SsoConnection_lastReproofAt_idx" ON "SsoConnection"("lastReproofAt");
