-- Collapse GatewayBudget's dual scope representation to inline-only (ADR-021).
--
-- GatewayBudget stored its target twice: once as (scopeType, scopeId) and
-- again as five typed nullable foreign-key columns kept consistent by a
-- fifty-line CHECK constraint the query layer never reads. Every read path
-- already discriminates on (scopeType, scopeId), so the typed columns and the
-- CHECK are pure write-time ceremony. Drop them, leaving (scopeType, scopeId)
-- plus organizationId as the single source of truth.
--
-- Scope-entity deletion cleanup (previously the FK onDelete: Cascade) moves to
-- the service layer, consistent with the no-foreign-key-constraints
-- convention. Budgets have no real production usage yet, so this is safe.

-- Dropping the columns also drops their dependent foreign-key constraints.
ALTER TABLE "GatewayBudget" DROP CONSTRAINT IF EXISTS "GatewayBudget_scope_check";

ALTER TABLE "GatewayBudget"
  DROP COLUMN "organizationScopedId",
  DROP COLUMN "teamScopedId",
  DROP COLUMN "projectScopedId",
  DROP COLUMN "virtualKeyScopedId",
  DROP COLUMN "principalUserId";

-- To roll back, uncomment and run manually (re-add columns, FKs, and the
-- scope CHECK; the data backfill would have to be reconstructed from
-- (scopeType, scopeId)):
-- ALTER TABLE "GatewayBudget"
--   ADD COLUMN "organizationScopedId" TEXT,
--   ADD COLUMN "teamScopedId" TEXT,
--   ADD COLUMN "projectScopedId" TEXT,
--   ADD COLUMN "virtualKeyScopedId" TEXT,
--   ADD COLUMN "principalUserId" TEXT;
