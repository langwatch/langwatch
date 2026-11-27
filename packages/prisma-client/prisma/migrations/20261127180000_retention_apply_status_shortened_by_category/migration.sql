-- IRREVERSIBLE: adds the nullable "shortenedAtByCategory" column to "RetentionApplyStatus".
-- A rollback leaves it in place: the previous release never reads or writes it, and dropping it is
-- an operator step confirmed in Ops.
-- Per retention category, the latest change at the scope that kept fewer days, so the drift
-- check defers only the category an admin shortened without applying
-- (modules/data-retention/specs/retention-drift-check.feature). Rows folded before it read as
-- having no deferred shortening.
ALTER TABLE "RetentionApplyStatus" ADD COLUMN IF NOT EXISTS "shortenedAtByCategory" JSONB;
