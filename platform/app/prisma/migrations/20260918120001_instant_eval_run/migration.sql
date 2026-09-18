-- The Instant Eval run: one row per LangWatchQL statement executed as a job.
--
-- This table holds the run's counters, not its answers. The judgements are one
-- ClickHouse row per trace and question in `instant_eval_judgments`, because a
-- hundred thousand rows times three questions is not a shape Postgres should
-- hold; what a caller polls is here.
--
-- Additive: a new enum type, a new table and its two indexes. Nothing existing
-- is read or rewritten, so a rolling deployment sees it appear unused.

CREATE TYPE "InstantEvalRunStatus" AS ENUM ('QUEUED', 'PLANNING', 'RUNNING', 'FINISHED', 'FAILED', 'CANCELLED');

CREATE TABLE "InstantEvalRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT,
    "sql" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "plan" JSONB NOT NULL DEFAULT '[]',
    "rowLimit" INTEGER NOT NULL,
    "status" "InstantEvalRunStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER,
    "matchedByQuestion" JSONB NOT NULL DEFAULT '{}',
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    -- The projection's checkpoint over the run's own event stream. Nullable
    -- because the row is created by the service that accepted the run, before
    -- any event has been folded onto it.
    "occurredAt" DOUBLE PRECISION,
    "acceptedAt" DOUBLE PRECISION,
    "lastEventId" TEXT,
    "projectionVersion" TEXT,

    CONSTRAINT "InstantEvalRun_pkey" PRIMARY KEY ("id")
);

-- Listing a project's runs newest first is the only list this table serves.
CREATE INDEX "InstantEvalRun_projectId_createdAt_idx" ON "InstantEvalRun"("projectId", "createdAt");

-- The stall watchdog sweeps the runs of a project that are still in flight.
CREATE INDEX "InstantEvalRun_projectId_status_idx" ON "InstantEvalRun"("projectId", "status");

-- Down migration (manual) --------------------------------------------------
-- Prisma migrations are append-only in CI, so this is recorded for an
-- operator rather than executed. To roll back, run:
--   DROP INDEX "InstantEvalRun_projectId_status_idx";
--   DROP INDEX "InstantEvalRun_projectId_createdAt_idx";
--   DROP TABLE "InstantEvalRun";
--   DROP TYPE  "InstantEvalRunStatus";
-- Safe in that order: the table is new here, so dropping it removes every row
-- this migration could have created and no other table references it.
