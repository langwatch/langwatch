-- CreateTable
CREATE TABLE "BillingMeterCheckpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billingMonth" TEXT NOT NULL,
    "lastReportedTotal" INTEGER NOT NULL DEFAULT 0,
    "pendingReportedTotal" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingMeterCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingMeterCheckpoint_organizationId_billingMonth_key" ON "BillingMeterCheckpoint"("organizationId", "billingMonth");
