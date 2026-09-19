-- License sync (ADR-139, section 6).
--
-- A connected install posts its seat counts once a day and gets a signed lease
-- back. Two things are kept here: the last report on the license row, which is
-- what the backoffice shows an operator, and the peak of each term quarter in
-- LicenseSeatReport, which is what the quarterly seat true-up invoices from.
--
-- The quarter is the license's own: three-month steps counted from the row's
-- issuedAt, so a license bought in February is billed in February steps.
-- (licenseId, quarterStartsAt) is unique, so a day's report raises the peak of
-- one row instead of appending another.
--
-- Additive only: four nullable columns and one empty table. A self-hosted
-- install gets the table and keeps it empty.

-- AlterTable
ALTER TABLE "IssuedLicense" ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncVersion" TEXT,
ADD COLUMN     "reportedMembers" INTEGER,
ADD COLUMN     "reportedMembersLite" INTEGER;

-- CreateTable
CREATE TABLE "LicenseSeatReport" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "quarterStartsAt" TIMESTAMP(3) NOT NULL,
    "peakMembers" INTEGER NOT NULL,
    "peakMembersLite" INTEGER NOT NULL,
    "firstReportedAt" TIMESTAMP(3) NOT NULL,
    "lastReportedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseSeatReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LicenseSeatReport_licenseId_idx" ON "LicenseSeatReport"("licenseId");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseSeatReport_licenseId_quarterStartsAt_key" ON "LicenseSeatReport"("licenseId", "quarterStartsAt");
