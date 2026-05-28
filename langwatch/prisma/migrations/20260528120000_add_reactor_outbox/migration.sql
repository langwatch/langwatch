-- ReactorOutbox: durable dispatch queue for stake-sensitive reactors.
--
-- See dev/docs/adr/021-transactional-outbox-for-stake-sensitive-dispatch.md
-- and ADRs 022-024 for the full rationale. In short: reactors registered
-- via `.withOutbox` enqueue rows here instead of dispatching inline. A
-- drainer leases rows (status → "dispatching"), calls the dispatch
-- endpoint, and records the outcome. The unique (reactorName, dedupKey)
-- is the claim primitive that makes pipeline replays safe — a second
-- enqueue is a no-op via `createMany skipDuplicates`.

-- CreateEnum
CREATE TYPE "ReactorOutboxStatus" AS ENUM ('queued', 'dispatching', 'dispatched', 'failed_retryable', 'dead');

-- CreateTable
CREATE TABLE "ReactorOutbox" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reactorName" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ReactorOutboxStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "leasedUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReactorOutbox_pkey" PRIMARY KEY ("id")
);

-- Claim primitive: a second enqueue for the same (reactorName, dedupKey)
-- is a no-op under `createMany skipDuplicates`. This is what makes
-- pipeline replays and retries safe.
CREATE UNIQUE INDEX "ReactorOutbox_reactorName_dedupKey_key" ON "ReactorOutbox"("reactorName", "dedupKey");

-- Drainer hot path: pick the next claimable row for a (project, reactor)
-- whose backoff has elapsed.
CREATE INDEX "ReactorOutbox_projectId_reactorName_status_nextAttemptAt_idx" ON "ReactorOutbox"("projectId", "reactorName", "status", "nextAttemptAt");

-- Operator surface: list stuck/dead dispatches per project.
CREATE INDEX "ReactorOutbox_projectId_status_updatedAt_idx" ON "ReactorOutbox"("projectId", "status", "updatedAt");

-- Crash recovery scan: find leased rows whose worker never came back.
CREATE INDEX "ReactorOutbox_status_leasedUntil_idx" ON "ReactorOutbox"("status", "leasedUntil");

-- AddForeignKey
ALTER TABLE "ReactorOutbox" ADD CONSTRAINT "ReactorOutbox_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- To roll back, uncomment and run manually:
-- DROP TABLE "ReactorOutbox";
-- DROP TYPE "ReactorOutboxStatus";
