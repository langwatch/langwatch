-- ADR-027 storage billing, schema phase. Purely additive: two new tables on top
-- of the current implementation. The billable-events checkpoint
-- (BillingMeterCheckpoint) and its unique index are left untouched — storage
-- billing owns its own persistence rather than discriminating the shared one.
--
-- StorageUsageHourly       — durable per-sealed-UTC-hour stored-bytes
--                            measurement + reporter cursor (reportedAt).
-- StorageBillingCheckpoint — dedicated two-phase reporting checkpoint for the
--                            STORAGE_GB meter (sibling of BillingMeterCheckpoint).
--
-- No ClickHouse migration — _size_bytes already exists (migration 00032).

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
    "lastReportedTotal" INTEGER NOT NULL DEFAULT 0,
    "pendingReportedTotal" INTEGER,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageBillingCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorageUsageHourly_reportedAt_idx" ON "StorageUsageHourly"("reportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBillingCheckpoint_organizationId_billingMonth_key" ON "StorageBillingCheckpoint"("organizationId", "billingMonth");

-- Down (reversible — purely additive). Commented out to avoid accidental data
-- loss; to roll back, uncomment and run manually:
-- DROP TABLE "StorageBillingCheckpoint";
-- DROP TABLE "StorageUsageHourly";
