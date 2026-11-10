-- Nurturing's one-time seed of each project's trace days from trace's own rollup, owned by
-- nurturing: the days before the trace-day fold's first trace of the project, so an organization
-- that traced before the fold started is not sent zero traces for 30 days. One row per project;
-- its presence marks the project seeded, so it is never seeded twice.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key: a deleted project's row is never read again.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingProjectTraceSeed";

CREATE TABLE IF NOT EXISTS "NurturingProjectTraceSeed" (
    "projectId" TEXT NOT NULL,
    "days" JSONB NOT NULL,
    "seededAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NurturingProjectTraceSeed_pkey" PRIMARY KEY ("projectId")
);
