-- IRREVERSIBLE: this migration is additive. Dropping the tables is an operator step, confirmed
-- in Ops once no release reads them. The tables are a read model, rebuildable from the
-- organization_seat_peak event log.
-- Organization's monthly seat peak as rows: counts, holders and months (ADR-002).
CREATE TABLE IF NOT EXISTS "OrganizationSeatPeak" (
    "organizationId" TEXT NOT NULL,
    "openedAt" DOUBLE PRECISION NOT NULL,
    "fullSeats" INTEGER NOT NULL,
    "liteSeats" INTEGER NOT NULL,
    "developerSeats" INTEGER NOT NULL,
    "latestChangeAt" DOUBLE PRECISION NOT NULL,
    "mismatches" INTEGER NOT NULL,

    CONSTRAINT "OrganizationSeatPeak_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE IF NOT EXISTS "OrganizationSeatPeakHolder" (
    "organizationId" TEXT NOT NULL,
    "holderKind" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "seat" TEXT NOT NULL,
    "lastChangedAt" DOUBLE PRECISION NOT NULL,
    "lastChangeId" TEXT,
    "expiresAt" DOUBLE PRECISION,
    "expiredByFold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrganizationSeatPeakHolder_pkey" PRIMARY KEY ("organizationId", "holderKind", "holderId")
);

CREATE INDEX IF NOT EXISTS "OrganizationSeatPeakHolder_organizationId_holderKind_seat_e_idx" ON "OrganizationSeatPeakHolder"("organizationId", "holderKind", "seat", "expiresAt");

CREATE TABLE IF NOT EXISTS "OrganizationSeatPeakMonth" (
    "organizationId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "fullPeak" INTEGER NOT NULL,
    "fullPeakAt" DOUBLE PRECISION NOT NULL,
    "litePeak" INTEGER NOT NULL,
    "litePeakAt" DOUBLE PRECISION NOT NULL,
    "fullAtEnd" INTEGER NOT NULL,
    "liteAtEnd" INTEGER NOT NULL,

    CONSTRAINT "OrganizationSeatPeakMonth_pkey" PRIMARY KEY ("organizationId", "month")
);
