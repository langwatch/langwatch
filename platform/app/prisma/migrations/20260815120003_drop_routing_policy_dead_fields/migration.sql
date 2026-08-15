-- IRREVERSIBLE: dropping a column deletes what it holds, and there is no down
-- step that could bring the values back. A rollback that re-adds the columns
-- gets them empty, so any policy that had once carried an allowlist or a
-- non-default strategy would come back without it.
--
-- What makes that acceptable is that neither column reaches the gateway.
-- "modelAllowlist" never became part of the bundle: the gateway reads
-- "models_allowed" off the virtual key, and the policy-level allow rules off
-- "policyRules". "strategy" is never emitted at all; the chain is always tried
-- in order. Both columns have been written by the product and read by nothing.
--
-- A production census on 2026-08-15 counted what this deletes:
--   1 routing policy total
--   0 with a non-empty modelAllowlist (0 entries, across 0 organizations)
--   0 on a strategy other than the default 'priority'
-- so this migration deletes no configuration a customer set. Re-run
-- scripts/report-routing-policy-dead-fields.ts against any other deployment
-- before applying it there; the script reports that the columns are already
-- gone rather than failing obscurely.
--
-- To roll back, uncomment and run manually. The values are NOT restored:
--
-- ALTER TABLE "RoutingPolicy"
--   ADD COLUMN "modelAllowlist" JSONB,
--   ADD COLUMN "strategy" TEXT NOT NULL DEFAULT 'priority';

-- Both drops ride one statement so the table takes its ACCESS EXCLUSIVE lock
-- once. Dropping a column only rewrites the catalog, so the lock is held for
-- the catalog update rather than for a scan of the table.
ALTER TABLE "RoutingPolicy"
  DROP COLUMN IF EXISTS "modelAllowlist",
  DROP COLUMN IF EXISTS "strategy";
