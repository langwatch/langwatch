-- The branch-recheck sweep's index, matched to the query the sweep actually
-- issues.
--
-- The sweep selects on `notFoundAt IS NOT NULL AND recheckAfter <= now AND
-- lastRequestedAt > now - 7 days`, orders by `recheckAfter` and takes 50. The
-- index it shipped with led on `organizationId`, which the sweep is the one
-- read in this feature that cannot name: it runs on a timer with no request
-- context, and its whole job is to find the due branches wherever they are.
-- With the leading column unbound and the sort column unindexed, Postgres fell
-- back to a sequential scan plus a top-N sort of the whole table. Measured on
-- 200k rows: Parallel Seq Scan, 197,655 rows removed by filter, 4,048 buffers,
-- 35.9 ms — and that grows with the table, which nothing bounded until now.
--
-- Leading on `recheckAfter` makes one index range answer both halves: the
-- boundary condition and the ordering. `lastRequestedAt` cuts the activity
-- horizon inside the index, and `notFoundAt` is carried so `IS NOT NULL` is an
-- index condition rather than a heap fetch per candidate — which is what keeps
-- the plan honest on a table where most due rows are rate-limit rows with a
-- null `notFoundAt`. Same 200k rows: Index Scan, 72 buffers, 1.0 ms.
--
-- The old index is dropped rather than kept: no query in the app reaches this
-- table by `(organizationId, notFoundAt)`. Every other read names the compound
-- unique key. An index nothing reads is write amplification on a table that
-- takes a row per agent branch.

-- DropIndex
DROP INDEX "GithubBranchPullRequestCheck_organizationId_notFoundAt_rech_idx";

-- CreateIndex
CREATE INDEX "GithubBranchPullRequestCheck_recheckAfter_lastRequestedAt_n_idx" ON "GithubBranchPullRequestCheck"("recheckAfter", "lastRequestedAt", "notFoundAt");

-- Down (manual): reverses this migration; run only to roll back.
--   DROP INDEX "GithubBranchPullRequestCheck_recheckAfter_lastRequestedAt_n_idx";
--   CREATE INDEX "GithubBranchPullRequestCheck_organizationId_notFoundAt_rech_idx" ON "GithubBranchPullRequestCheck"("organizationId", "notFoundAt", "recheckAfter");
