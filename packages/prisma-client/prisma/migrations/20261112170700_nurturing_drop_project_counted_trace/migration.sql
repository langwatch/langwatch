-- Drops NurturingProjectCountedTrace, the per-trace ledger an earlier version of this change created
-- (migration 20261112120000_nurturing_project_counted_trace, since removed). Nurturing now counts
-- per day with no ledger (issue 9378), so databases that applied the old migration converge here.
--
-- Contract: the table is nurturing's own and nothing else reads or writes it.
--
-- Spec: enterprise/modules/nurturing/specs/project-usage.feature
--
-- IRREVERSIBLE: there is no down migration; the dropped rows were only a dedupe ledger.

DROP TABLE IF EXISTS "NurturingProjectCountedTrace";
