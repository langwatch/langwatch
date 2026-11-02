-- IRREVERSIBLE: this migration is additive. Dropping the table is an operator step, confirmed
-- in Ops once no release reads it. The table is a read model, rebuildable from the
-- organization_seat_peak event log.
-- Organization's monthly seat peak, folded per organization from its seat changes (ADR-002).
CREATE TABLE IF NOT EXISTS "OrganizationSeatPeakProjection" (
    "organizationId" TEXT NOT NULL,
    "folded" JSONB NOT NULL,
    "createdAt" DOUBLE PRECISION NOT NULL,
    "updatedAt" DOUBLE PRECISION NOT NULL,
    "occurredAt" DOUBLE PRECISION NOT NULL,
    "acceptedAt" DOUBLE PRECISION NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "projectionVersion" TEXT NOT NULL,

    CONSTRAINT "OrganizationSeatPeakProjection_pkey" PRIMARY KEY ("organizationId")
);
