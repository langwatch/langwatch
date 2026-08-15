-- The parameters a scenario declares: an array of
-- { name, description?, defaultValue? }.
--
-- A scenario owner names the values a run depends on so the same scenario can
-- run against another account, tenant or region without rewriting it. Values
-- are supplied or overridden when a run starts, delivered to the target under
-- test, and readable from the scenario's own situation and criteria as
-- `params.NAME`.
--
-- Nullable with no default and no backfill: NULL and an empty array both mean
-- "this scenario declares none", which is true of every existing row and is
-- the path that hands the scenario's text on untouched.

-- AlterTable
ALTER TABLE "Scenario" ADD COLUMN "parameters" JSONB;

-- Down (manual): reverses this migration; run only to roll back.
--
-- WARNING: the drop discards every parameter any scenario declares, with its
-- name, description and default value. Those are authored by hand and nothing
-- else stores them, so the only way back is a database restore. Export the
-- column before running it.
--   ALTER TABLE "Scenario" DROP COLUMN "parameters";
