-- Owned by user: the public changelog entry each person last opened from the sidebar's
-- "What's new" card, so the unseen dot clears on every browser they sign in from.
--
-- Expand only: a nullable column, no default, no rewrite, no backfill. No foreign key.
--
-- Spec: modules/navigation/specs/whats-new.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   ALTER TABLE "User" DROP COLUMN "whatsNewSeenEntryId";

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsNewSeenEntryId" TEXT;
