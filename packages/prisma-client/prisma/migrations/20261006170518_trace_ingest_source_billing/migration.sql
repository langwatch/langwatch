-- CreateTable
CREATE TABLE "TraceIngestSourceBilling" (
    "organizationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "billed" BOOLEAN NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TraceIngestSourceBilling_pkey" PRIMARY KEY ("organizationId","sourceType")
);
