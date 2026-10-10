-- GitHub's own `updated_at` for the stored pull-request snapshot.
--
-- The column is the freshness guard on every write to the row. GitHub permits
-- out-of-order webhook delivery, so a delayed `opened` or `edited` can arrive
-- after `closed` was applied. The write path compares this column against the
-- incoming snapshot and skips a strictly older one, which is what stops a late
-- delivery from reopening a merged pull request and clearing the close and
-- merge times that session-to-pull-request attribution reads.
--
-- Nullable with no default and no backfill: rows written before this column
-- existed carry no source timestamp, and inventing one would be a claim we
-- cannot support. NULL means "unknown", so the next write is accepted and the
-- row starts carrying the timestamp from then on.

-- AlterTable
ALTER TABLE "GithubPullRequest" ADD COLUMN "prUpdatedAt" TIMESTAMP(3);

-- To roll back, uncomment and run manually.
--   ALTER TABLE "GithubPullRequest" DROP COLUMN "prUpdatedAt";
