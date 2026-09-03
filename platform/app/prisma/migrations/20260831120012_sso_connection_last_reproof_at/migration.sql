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
-- This is operational scheduling state, not connection history. A healthy
-- re-read states no fact, and `SsoConnection` is a whole-row projection whose
-- fold is its only writer, so the cursor lives in its own additive table.
-- Absence sorts first at the relation read, so every existing connection is
-- swept before any that already has a cursor.
--
-- To roll back, uncomment and run manually. Dropping the cursor returns the
-- sweep to having no safe round-robin position; do not restore `updatedAt`
-- ordering, which has the gap above.
-- DROP TABLE "SsoConnectionReproofCursor";

CREATE TABLE "SsoConnectionReproofCursor" (
    "connectionId" TEXT NOT NULL,
    "lastReproofAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoConnectionReproofCursor_pkey" PRIMARY KEY ("connectionId")
);

-- The sweep's own read: the connections it may look at, oldest look first.
CREATE INDEX "SsoConnectionReproofCursor_lastReproofAt_idx"
ON "SsoConnectionReproofCursor"("lastReproofAt");
