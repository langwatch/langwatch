-- ADR-094 Decision 3 / Invariants "Closed periods never change silently".
--
-- Backdating a link is how corrections work and stays allowed. What it must
-- not be is silent: once a period has been reported, a link appended later but
-- effective inside that period changes who spent already-published money, and
-- the next report has to say so.
--
-- This table records THAT a window was exported and when — never the numbers.
-- Storing the numbers would make it a second source of truth for attribution,
-- and read-time resolution exists precisely so there is only one.
--
-- Additive: a new table, no existing column changes. Organizations that never
-- export see no behavior change, and the notice simply never fires for them.

-- CreateTable
CREATE TABLE "AttributionReportExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,

    CONSTRAINT "AttributionReportExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The notice asks for the organization's most recent export, so the index is
-- exactly that query.
CREATE INDEX "AttributionReportExport_organizationId_exportedAt_idx" ON "AttributionReportExport"("organizationId", "exportedAt" DESC);

-- Down (manual): reverses this migration; run only to roll back.
--   DROP TABLE "AttributionReportExport";
