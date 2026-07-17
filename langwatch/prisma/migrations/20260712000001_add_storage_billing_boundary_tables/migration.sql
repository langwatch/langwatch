-- ADR-039 storage billing, schema phase (1 of 4). Purely additive: five new
-- tables. The billable-events checkpoint (BillingMeterCheckpoint) is untouched
-- — storage billing owns its own persistence.
--
-- StorageBoundaryEvent     — signed boundary events; the fold's source of
--                            truth and the billing audit trail.
-- StorageBillableGauge     — materialized fold result, one row per org.
-- StorageUsageHourly       — per-sealed-UTC-hour sample + reporter cursor
--                            (contract kept from ADR-027 unchanged).
-- StorageBillingCheckpoint — lean reporter failure tracking (no accumulator
--                            columns; the predecessor's were dead code).
-- StorageSweepCursor       — durable once-per-hour sweep guarantee (singleton).
--
-- deltaBytes / billableBytes are BIGINT: INT32 overflows at ~2.8 TiB-month.
-- No ClickHouse migration — _size_bytes already exists (migration 00032).

-- CreateTable
CREATE TABLE "StorageBoundaryEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "partitionKey" TEXT NOT NULL,
    "sliceDate" TIMESTAMP(3) NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "edge" TEXT NOT NULL,
    "deltaBytes" BIGINT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageBoundaryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageBillableGauge" (
    "organizationId" TEXT NOT NULL,
    "billableBytes" BIGINT NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageBillableGauge_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "StorageUsageHourly" (
    "organizationId" TEXT NOT NULL,
    "sealedHour" TIMESTAMP(3) NOT NULL,
    "megabytes" INTEGER NOT NULL,
    "reportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorageUsageHourly_pkey" PRIMARY KEY ("organizationId","sealedHour")
);

-- CreateTable
CREATE TABLE "StorageBillingCheckpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billingMonth" TEXT NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageBillingCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageSweepCursor" (
    "id" TEXT NOT NULL,
    "lastSweptSealedHour" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageSweepCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageBoundaryEvent_dedupKey_key" ON "StorageBoundaryEvent"("dedupKey");

-- CreateIndex
CREATE INDEX "StorageBoundaryEvent_organizationId_occurredAt_idx" ON "StorageBoundaryEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "StorageUsageHourly_reportedAt_idx" ON "StorageUsageHourly"("reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBillingCheckpoint_organizationId_billingMonth_key" ON "StorageBillingCheckpoint"("organizationId", "billingMonth");

-- Down (reversible — purely additive). Commented out to avoid accidental data
-- loss; to roll back, uncomment and run manually:
-- DROP TABLE "StorageSweepCursor";
-- DROP TABLE "StorageBillingCheckpoint";
-- DROP TABLE "StorageUsageHourly";
-- DROP TABLE "StorageBillableGauge";
-- DROP TABLE "StorageBoundaryEvent";
