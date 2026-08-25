-- ADR-094 Decision 9: erasure stamps `erasedAt` on every touched link AND
-- inventory row, so "this person was forgotten" never reads as "the provider
-- never told us who owns this bot".
--
-- ProviderIdentityLink got its column in the foundations migration;
-- DiscoveredAgent did not, because nothing blanked snapshots until the erasure
-- service landed. This adds it.
--
-- Additive and nullable: every existing row keeps NULL, which is the correct
-- reading — none of them has been erased.

-- AlterTable
ALTER TABLE "DiscoveredAgent" ADD COLUMN "erasedAt" TIMESTAMP(3);

-- Down (manual): reverses this migration; run only to roll back.
--   ALTER TABLE "DiscoveredAgent" DROP COLUMN "erasedAt";
