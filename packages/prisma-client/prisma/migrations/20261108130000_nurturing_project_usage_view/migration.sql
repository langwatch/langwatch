-- Nurturing's own per-project usage, owned by nurturing: a peer fold over the owners'
-- prompt, evaluator, scenario and trace events (ARCHITECTURE §9), summed per organization
-- for the per-email Customer.io traits. One peer fold per owner pipeline (a peer fold
-- re-folds from one owner's log), so one row per owner and project, id `<owner>:<project>`;
-- the folded usage as JSON beside the project and the organization placement answered.
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key: the rows are rebuilt from the owners' event logs by a projection replay
-- of the lanes `nurturing_project_usage.<owner>Usage` (prompt, evaluator, scenario,
-- simulation, trace).
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingProjectUsageView";

CREATE TABLE IF NOT EXISTS "NurturingProjectUsageView" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT,
    "folded" JSONB NOT NULL,
    "appliedEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectionVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NurturingProjectUsageView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NurturingProjectUsageView_projectId_idx"
    ON "NurturingProjectUsageView"("projectId");

CREATE INDEX IF NOT EXISTS "NurturingProjectUsageView_organizationId_idx"
    ON "NurturingProjectUsageView"("organizationId");
