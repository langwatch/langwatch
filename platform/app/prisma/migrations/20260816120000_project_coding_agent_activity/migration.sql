-- When a coding-agent session was last folded for this project, and when a
-- pull request was last mapped for a branch one of those sessions ran on.
--
-- Nullable with no default and no backfill: a null means "no coding-agent
-- signal seen", which is the correct starting answer for every existing
-- project. Both columns are read by project id (the primary key), so neither
-- needs an index.
--
-- To roll back, uncomment and run manually. Dropping the columns discards the
-- recorded activity, and the project sidebar hides its Sessions and Pull
-- requests destinations until each project sends coding-agent telemetry again.
-- ALTER TABLE "Project" DROP COLUMN "lastCodingAgentSessionAt";
-- ALTER TABLE "Project" DROP COLUMN "lastCodingAgentPullRequestAt";

ALTER TABLE "Project" ADD COLUMN "lastCodingAgentSessionAt" TIMESTAMP(3);

ALTER TABLE "Project" ADD COLUMN "lastCodingAgentPullRequestAt" TIMESTAMP(3);
