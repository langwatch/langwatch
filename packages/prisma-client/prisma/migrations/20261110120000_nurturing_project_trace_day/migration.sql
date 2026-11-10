-- Nurturing's own trace counts, owned by nurturing: a peer fold over trace's span_received
-- (ARCHITECTURE §9) that counts a root span as one trace, as trace's rollup does, with its error
-- status. One row per project and UTC day of append time, the counts as JSON; the per-email
-- Customer.io traits sum an organization's last 30 days, and the sync deletes older days.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key: the rows are rebuilt from trace's event log by a projection replay of the
-- lane `nurturing_project_usage.traceDays`.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingProjectTraceDay";

CREATE TABLE IF NOT EXISTS "NurturingProjectTraceDay" (
    "projectId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "folded" JSONB NOT NULL,
    "appliedEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectionVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NurturingProjectTraceDay_pkey" PRIMARY KEY ("projectId", "day")
);
