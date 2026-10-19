-- Why an automation was paused, and when.
--
-- `active = false` already existed but says nothing about WHO turned it off. A
-- customer who paused their own automation and one the platform paused for
-- runaway volume look identical in the row, so the UI cannot explain the second
-- case and `toggleTrigger` cannot tell that resuming it should clear anything.
--
-- Both columns are nullable with no default and no backfill: every existing
-- row was paused by a person, if it was paused at all, and inventing a reason
-- for those would be a claim we cannot support. NULL means "not paused by the
-- platform", which is the truth for all of them.

-- AlterTable
ALTER TABLE "Trigger" ADD COLUMN "pausedReason" TEXT;
ALTER TABLE "Trigger" ADD COLUMN "pausedAt" TIMESTAMPTZ(3);

-- Down (manual): reverses this migration; run only to roll back.
--   ALTER TABLE "Trigger" DROP COLUMN "pausedReason";
--   ALTER TABLE "Trigger" DROP COLUMN "pausedAt";
