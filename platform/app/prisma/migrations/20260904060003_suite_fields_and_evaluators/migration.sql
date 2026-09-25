-- A test suite declares typed fields beyond situation and criteria, every
-- scenario filed in it carries a value per field, and evaluators attach to a
-- suite or a run plan with mappings from each input to a source.
--
-- Three nullable JSON columns, all additive. Null reads as "none" on every
-- one of them, so a row written before this migration behaves exactly as it
-- did: no fields, no values, no evaluators.
--
--   * "SimulationSuite"."fields": the fields a test suite declares, as an
--     array of { identifier, type }. A run plan carries none.
--   * "SimulationSuite"."evaluators": the evaluator attachments of a test
--     suite or a run plan, as an array of { id, evaluatorId, required,
--     mappings }.
--   * "Scenario"."fields": the values a scenario carries, keyed by field
--     identifier.
--
-- Adding a nullable column with no default is a catalog change in Postgres:
-- no row is rewritten, so the lock is brief on a table of any size.

ALTER TABLE "SimulationSuite" ADD COLUMN "fields" JSONB;
ALTER TABLE "SimulationSuite" ADD COLUMN "evaluators" JSONB;
ALTER TABLE "Scenario" ADD COLUMN "fields" JSONB;

-- Down (manual rollback; uncomment and run). Dropping the columns discards
-- every declared field, every scenario value and every attachment.
-- ALTER TABLE "Scenario" DROP COLUMN "fields";
-- ALTER TABLE "SimulationSuite" DROP COLUMN "evaluators";
-- ALTER TABLE "SimulationSuite" DROP COLUMN "fields";
