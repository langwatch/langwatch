-- AlterTable
-- An organization's opt-in to Instant Evals: when a member switched them on
-- from the search bar, and who. Null until then.
ALTER TABLE "Organization" ADD COLUMN "instantEvalsEnabledAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN "instantEvalsEnabledByUserId" TEXT;
