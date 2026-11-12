-- When nurturing first saw a project's traces with no placement copy (NurturingProject), owned by
-- nurturing. Its trace batches are retried only within one window from this time, the same window
-- on every worker and across a restart; past it they are dropped. The row is deleted when the
-- project's copy lands, from project's lw.project.created. Reads no other module.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingUncopiedProject";

CREATE TABLE IF NOT EXISTS "NurturingUncopiedProject" (
    "projectId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NurturingUncopiedProject_pkey" PRIMARY KEY ("projectId")
);
