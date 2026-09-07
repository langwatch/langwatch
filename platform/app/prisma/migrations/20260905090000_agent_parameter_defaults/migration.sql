-- A user can set default values for a connected agent's declared parameters,
-- kept outside "Agent"."config" so an SDK re-register (which replaces config
-- wholesale) cannot clobber them (issue 7948).
--
-- One nullable JSON column, additive. Null reads as "no user defaults" on every
-- row, so a row written before this migration behaves exactly as it did: the
-- code defaults are the only defaults.
--
--   * "Agent"."parameterDefaults": the user-set defaults, as an object keyed by
--     declared parameter name, with a string, number or boolean value each.
--
-- Adding a nullable column with no default is a catalog change in Postgres: no
-- row is rewritten, so the lock is brief on a table of any size.

ALTER TABLE "Agent" ADD COLUMN "parameterDefaults" JSONB;

-- Down (manual rollback; uncomment and run). Dropping the column discards every
-- user-set parameter default.
-- ALTER TABLE "Agent" DROP COLUMN "parameterDefaults";
