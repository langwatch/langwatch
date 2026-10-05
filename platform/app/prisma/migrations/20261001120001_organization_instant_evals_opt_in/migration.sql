-- AlterTable
-- An organization's opt-in to Instant Evals: when a member switched them on
-- from the search bar, and who. Null until then.
ALTER TABLE "Organization" ADD COLUMN "instantEvalsEnabledAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "instantEvalsEnabledByUserId" TEXT;

-- Down (manual). Running it destroys the consent record: which member agreed
-- to send judged text to the judge's provider, and when. Nothing else holds
-- that record, so every organization would have to agree again. Rolling the
-- code back without it is safe: the columns stay unread and no organization
-- is switched on by them.
--   ALTER TABLE "Organization" DROP COLUMN "instantEvalsEnabledByUserId";
--   ALTER TABLE "Organization" DROP COLUMN "instantEvalsEnabledAt";
