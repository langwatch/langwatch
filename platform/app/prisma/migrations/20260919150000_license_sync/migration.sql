-- License sync (ADR-141, section 6).
--
-- A connected install posts its seat counts once a day and gets back the
-- services its license is entitled to and, when one is waiting, a reissued
-- license. What is kept is the last report on the license row, which is what
-- the backoffice shows an operator and what the lead signals read.
--
-- Additive only: four nullable columns. A self-hosted install keeps them null.

-- AlterTable
ALTER TABLE "IssuedLicense" ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncVersion" TEXT,
ADD COLUMN     "reportedMembers" INTEGER,
ADD COLUMN     "reportedMembersLite" INTEGER;
