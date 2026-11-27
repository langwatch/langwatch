-- Nurturing's own trace counts as peer folds (ARCHITECTURE §9), owned by nurturing: one row per
-- project, UTC day of append time and source. `spans` rows are folded from trace's span_received (a
-- customer root span is one trace), `failures` rows from trace's lw.trace.trace_failed. Each fold
-- owns its rows, applied event ids and projection version; readers sum a day's sources. A
-- projection replay rebuilds the rows from trace's log. Replaces "NurturingProjectTraceDay", which
-- stays in place, unread; dropping it is an operator step.
--
-- The new table is seeded from NurturingProjectTraceDay, so the readers that switch to it at deploy
-- never see fewer traces than the old table held: each old row becomes a `spans` row (traceCount,
-- lastTraceAt) and a `failures` row (errorCount, lastFailedTraceAt), at the folds' projection
-- version, with no applied event ids. A source with nothing counted gets no row, as the folds never
-- store an empty state. No event is counted twice:
--   * A queued job is consumed once, by an old pod (into the old table, so in the seed if it ran
--     before this migration) or by a new pod (into this table, on top of the seed); never both,
--     except an old-pod batch that counted and failed before its ack, which is retried on a new
--     pod and counts twice until the replay rebuilds that day.
--   * The deploy replay refolds each day with an event in the window from trace's log and
--     overwrites the row whole, appliedEventIds included, so the seed's counts are replaced, not
--     added to. Days the replay does not reach are older than the counting window and pruned.
--   * ON CONFLICT DO NOTHING keeps a rerun from touching rows the folds have since written.
-- Jobs an old pod runs after this migration land only in the old table; the replay restores them.
--
-- Expand only: a new table, seeded by INSERT ... SELECT, which only reads the old one. Nothing is
-- altered or dropped, so the previous release keeps reading and writing NurturingProjectTraceDay.
-- No foreign key, as for NurturingProjectTraceDay.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingProjectTraceDayCount";

CREATE TABLE IF NOT EXISTS "NurturingProjectTraceDayCount" (
    "projectId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "traceCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastTraceAt" TIMESTAMP(3),
    "lastFailedTraceAt" TIMESTAMP(3),
    "appliedEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectionVersion" TEXT NOT NULL,

    CONSTRAINT "NurturingProjectTraceDayCount_pkey" PRIMARY KEY ("projectId", "day", "source")
);

CREATE INDEX IF NOT EXISTS "NurturingProjectTraceDayCount_day_idx" ON "NurturingProjectTraceDayCount"("day");

INSERT INTO "NurturingProjectTraceDayCount"
  ("projectId", "day", "source", "traceCount", "lastTraceAt", "projectionVersion")
SELECT "projectId", "day", 'spans', "traceCount", "lastTraceAt", '2026-11-23'
FROM "NurturingProjectTraceDay"
WHERE "traceCount" > 0
ON CONFLICT DO NOTHING;

INSERT INTO "NurturingProjectTraceDayCount"
  ("projectId", "day", "source", "errorCount", "lastFailedTraceAt", "projectionVersion")
SELECT "projectId", "day", 'failures', "errorCount", "lastFailedTraceAt", '2026-11-23'
FROM "NurturingProjectTraceDay"
WHERE "errorCount" > 0
ON CONFLICT DO NOTHING;
