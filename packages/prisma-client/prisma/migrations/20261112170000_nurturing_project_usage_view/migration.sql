-- Nurturing's own per-project usage, owned by nurturing: a peer fold over the owners' prompt,
-- evaluator, scenario and simulation-run events (ARCHITECTURE §9), summed per organization for
-- the per-email Customer.io traits. One peer fold per owner pipeline (a peer fold re-folds from
-- one owner's log), so one row per project and owner; the folded usage as JSON. One more row
-- per project, owner `evaluation`, holds its evaluation days, written at most once a day. Traces
-- are counted per day in NurturingProjectTraceDay (migration 20261112170100_nurturing_project_trace_day).
--
-- Expand only: a new table nobody else reads or writes. Nothing is altered or dropped.
-- No foreign key: the rows are rebuilt from the owners' event logs by a projection replay
-- of the lanes `nurturing_project_usage.<owner>Usage` (prompt, evaluator, scenario,
-- simulation).
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "NurturingProjectUsageView";

CREATE TABLE IF NOT EXISTS "NurturingProjectUsageView" (
    "projectId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "folded" JSONB NOT NULL,
    "appliedEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectionVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NurturingProjectUsageView_pkey" PRIMARY KEY ("projectId", "owner")
);
