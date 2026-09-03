-- How Langy reaches this person's code when a task needs a change (ADR-129).
--
-- "langyCodeAccessPreference" holds "github" when the person chose the pull
-- request path and asked to be remembered. NULL means Langy asks. A shared
-- local folder is never stored here: a folder has to be shared again each
-- time, so remembering one would promise access the platform does not have.
--
-- IRREVERSIBLE: there is no down migration.
--
-- The schema part reverses with the statement below, run by hand:
--
--   ALTER TABLE "User" DROP COLUMN "langyCodeAccessPreference";
--
-- The data part does not. The column is the only record of the choice, so
-- dropping it makes Langy ask every person again.

ALTER TABLE "User" ADD COLUMN "langyCodeAccessPreference" TEXT;
