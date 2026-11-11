-- Each trace nurturing counted into NurturingProjectTraceDay (migration 20261110120000), once per
-- kind (`trace` for its root span, `failed` for trace's lw.trace.trace_failed), owned by
-- nurturing. The count's write inserts the batch's traces here ON CONFLICT DO NOTHING and adds
-- only the rows it inserted to the day, in one statement, so a re-stored trace or a redelivered
-- fact counts once (issue 9378 AC 3). Written only for organizations inside their trace counting
-- window; pruned by day with the day rows' 30-day retention.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key. Not rebuilt by a replay: like the day rows, it is a subscriber's, not a fold's.
--
-- Also an index on NurturingOrganizationCreated."createdAt" (the same owner), for the hourly sweep
-- that ends each organization's trace window: it reads the organizations created in an hour.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingProjectCountedTrace";
--   DROP INDEX "NurturingOrganizationCreated_createdAt_idx";

CREATE TABLE IF NOT EXISTS "NurturingProjectCountedTrace" (
    "projectId" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "appendedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NurturingProjectCountedTrace_pkey" PRIMARY KEY ("projectId", "traceId", "kind")
);

CREATE INDEX IF NOT EXISTS "NurturingProjectCountedTrace_day_idx" ON "NurturingProjectCountedTrace" ("day");

-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "NurturingOrganizationCreated_createdAt_idx" ON "NurturingOrganizationCreated" ("createdAt");
-- (a failed concurrent build leaves an invalid index: check pg_index.indisvalid, DROP INDEX CONCURRENTLY, retry)
CREATE INDEX IF NOT EXISTS "NurturingOrganizationCreated_createdAt_idx" ON "NurturingOrganizationCreated" ("createdAt");
