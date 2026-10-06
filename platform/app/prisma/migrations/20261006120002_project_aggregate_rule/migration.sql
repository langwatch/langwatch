-- ADR-144: the scope rule an aggregate project materialises into grants.
--
-- Null on every project that exists today: only a project of kind
-- "aggregate" carries a rule. One of three shapes:
--   { kind: "all-personal" }
--   { kind: "personal-by-department", departmentId }
--   { kind: "explicit", projectIds: [...] }
-- The rule is data, not an access decision: the reconciler resolves it to
-- one shared project-reader grant per member, and reads go through those
-- grants, never through this column.
--
-- Down, to roll back by hand:
--   ALTER TABLE "Project" DROP COLUMN "aggregateRule";
-- Rolling back forgets every aggregate's rule; the grants already in the
-- ledger stay until the reconciler, finding no rule, revokes them.
ALTER TABLE "Project"
  ADD COLUMN "aggregateRule" JSONB;
