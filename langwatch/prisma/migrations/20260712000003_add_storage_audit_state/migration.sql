-- ADR-039 phase 3. Audit posture per organization: an org that has ever
-- tripped a storage-billing audit alarm stays on the daily audit tier
-- permanently (Decision 7). Alarms are recorded, never auto-corrected.

-- CreateTable
CREATE TABLE "StorageAuditState" (
    "organizationId" TEXT NOT NULL,
    "everAlarmedAt" TIMESTAMP(3),
    "lastAlarmKind" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageAuditState_pkey" PRIMARY KEY ("organizationId")
);

-- Down (commented out; to roll back, run manually):
-- DROP TABLE "StorageAuditState";
