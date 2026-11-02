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
