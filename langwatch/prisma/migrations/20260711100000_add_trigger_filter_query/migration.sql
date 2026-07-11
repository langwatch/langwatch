-- ADR-043 Subject facet: the Traces-V2 liqe query string a trace-subject
-- automation is about. NULL = legacy `filters`-driven trigger (unchanged).
-- Nullable with no default, so existing rows stay legacy and no backfill runs.

-- AlterTable
ALTER TABLE "Trigger" ADD COLUMN "filterQuery" TEXT;

-- To roll back, uncomment and run manually:
-- ALTER TABLE "Trigger" DROP COLUMN "filterQuery";
