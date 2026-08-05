-- J1 — governance-table truncate companion to J2.
--
-- Rationale (locked in tmp/REFACTOR-PLAN-vk-modelprovider.md §Migration strategy):
-- governance tables (IngestionSource, IngestionTemplate, UserIngestionBinding,
-- AnomalyRule, plus their child rows) have NO production users yet — the
-- entire surface ships behind release_ui_ai_governance_enabled flag. Per
-- rchaves "we never had VK-specific RBAC; no back-compat at the code level,
-- but the gateway tables in prod still need forward-only migration discipline;
-- governance tables are fine to truncate-and-reseed". J2 handles the
-- gateway-table forward-only sequence; this migration handles the governance
-- bucket separately.
--
-- After this migration applies, run:
--   pnpm tsx scripts/seed-governance-refactor-dogfood.ts
-- to repopulate a coherent dev-DB state. Without the seed, /me + the
-- AI Governance UI render empty (technically correct, observationally
-- confusing during dogfood).
--
-- TRUNCATE ... CASCADE is used so child rows (UserIngestionBinding ->
-- IngestionTemplate, AnomalyEvents -> AnomalyRule) drop with the parent
-- without a manual ordering. `RESTART IDENTITY` resets any sequence on
-- the truncated tables so re-seeded rows start from a clean numbering.
--
-- This migration intentionally does NOT touch:
--   - VirtualKey, VirtualKeyScope, ModelProvider, ModelProviderScope,
--     GatewayBudget, RoutingPolicy, GatewayBudgetLedger — those are
--     gateway tables and were forward-migrated in J2 (20260524120000).
--   - Project / Team / Organization / User — base entities, never wiped.
--   - LangWatch-tenant tables (Trace, Span, etc.) — orthogonal product
--     surface, never wiped.
--
-- Operator note: this is INTENDED to be destructive on the governance
-- bucket. Do not run against a deployment that has accepted real
-- IngestionSource configurations from a customer; instead, drop the
-- migration and write a per-row backfill if that ever happens. As of
-- the iter-110 cutover there is no such customer.

-- ---------------------------------------------------------------------------
-- Step 1: child + leaf tables first, then parents (defensive even though
-- TRUNCATE CASCADE handles dependencies — keeps the order auditable).
-- ---------------------------------------------------------------------------

-- Fail-safe gate: this reset is destructive and runs on every
-- `migrate deploy`, so it MUST NOT fire in an environment that holds real
-- governance rows. It only truncates when the operator explicitly opts in
-- for a dogfood reset by setting the GUC before running:
--
--     SET langwatch.allow_governance_truncate = 'true';
--
-- With the setting absent (the default, including every fresh deploy) the
-- block is a no-op and the migration is recorded as applied either way.
-- AnomalyEvent / ActivityMonitorEvent exist conditionally, so they stay
-- behind IF EXISTS for partial governance-stack states during the cutover.
DO $$
BEGIN
  IF current_setting('langwatch.allow_governance_truncate', true) IS DISTINCT FROM 'true' THEN
    RAISE NOTICE 'governance truncate skipped: set langwatch.allow_governance_truncate = ''true'' to enable (dogfood reset only)';
    RETURN;
  END IF;

  TRUNCATE TABLE "UserIngestionBinding" RESTART IDENTITY CASCADE;
  TRUNCATE TABLE "IngestionTemplate"    RESTART IDENTITY CASCADE;
  TRUNCATE TABLE "IngestionSource"      RESTART IDENTITY CASCADE;
  TRUNCATE TABLE "AnomalyRule"          RESTART IDENTITY CASCADE;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'AnomalyEvent') THEN
    EXECUTE 'TRUNCATE TABLE "AnomalyEvent" RESTART IDENTITY CASCADE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ActivityMonitorEvent') THEN
    EXECUTE 'TRUNCATE TABLE "ActivityMonitorEvent" RESTART IDENTITY CASCADE';
  END IF;
END $$;
