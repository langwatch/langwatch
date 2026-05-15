-- Convert ModelProviderScope.scopeType from raw TEXT to a typed
-- Postgres enum, mirroring RoleBindingScopeType and
-- GatewayBudgetScopeType. The per-table-enum convention is documented
-- in dev/docs/best_practices/scoped-resources.md. Storage-side
-- invariants (no junk values, no typos at the column level) replace
-- the inline TS union casts at the call sites.
--
-- The 20260419230000 migration that introduced ModelProviderScope is
-- already deployed; this is a strict additive ALTER. Postgres validates
-- every existing row against the new enum at ALTER time, so any
-- not-in-enum row would fail loudly here — every production row
-- should currently be one of 'ORGANIZATION'/'TEAM'/'PROJECT' (the
-- service layer rejects anything else). The USING cast is explicit so
-- the column rewrite is deterministic.

CREATE TYPE "ModelProviderScopeType" AS ENUM ('ORGANIZATION', 'TEAM', 'PROJECT');

ALTER TABLE "ModelProviderScope"
    ALTER COLUMN "scopeType" TYPE "ModelProviderScopeType"
    USING ("scopeType"::"ModelProviderScopeType");

-- Down migration (commented out — Postgres can demote an enum column
-- back to TEXT cleanly, but the DROP TYPE step fails if any other
-- object still references the enum; running it manually after rolling
-- back any code that depends on the enum is the safer path):
--
-- ALTER TABLE "ModelProviderScope"
--     ALTER COLUMN "scopeType" TYPE TEXT;
-- DROP TYPE "ModelProviderScopeType";
