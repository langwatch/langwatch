-- Per retention category, the latest change at the scope that kept fewer days, so the drift
-- check defers only the category an admin shortened without applying
-- (modules/data-retention/specs/retention-drift-check.feature). Nullable: the previous release
-- never writes it, and rows folded before it read as having no deferred shortening.
ALTER TABLE "RetentionApplyStatus" ADD COLUMN IF NOT EXISTS "shortenedAtByCategory" JSONB;
