-- IRREVERSIBLE: no down step. The column being dropped carried the opposite
-- meaning of the one being added, so a rollback would read every switched-on
-- service as a switched-off one. Rolling the code back alone is safe: the new
-- column stays unread and the install falls back to sending nothing.
--
-- Connected self-hosted (ADR-139, section 2): a service a license is entitled
-- to is on unless an administrator switched it off.
--
-- The old column listed what was switched ON, which made the entitled state
-- and the default state disagree: a customer who bought hosted judging had to
-- find a settings page before anything worked. The new column lists what was
-- switched OFF, so the default needs no row and an explicit refusal survives a
-- licence change.
--
-- Nothing is carried across. This ships before the first connected install, so
-- there is no customer choice to lose; a row in the old column meant "on",
-- which is what the new default already says.

ALTER TABLE "Organization" DROP COLUMN "connectServices";
ALTER TABLE "Organization" ADD COLUMN "connectServicesDisabled" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
