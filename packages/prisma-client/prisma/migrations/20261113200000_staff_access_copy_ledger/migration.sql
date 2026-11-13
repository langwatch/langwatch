-- The organization copy ledger (staff-access module ADR-002).
CREATE TABLE IF NOT EXISTS "StaffAccessCopyLedger" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceOrganizationId" TEXT NOT NULL,
    "targetOrganizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "sourceProjectId" TEXT NOT NULL,
    "targetProjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffAccessCopyLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StaffAccessCopyLedger_targetOrganizationId_kind_sourceId_key" ON "StaffAccessCopyLedger"("targetOrganizationId", "kind", "sourceId");
CREATE INDEX IF NOT EXISTS "StaffAccessCopyLedger_pair_idx" ON "StaffAccessCopyLedger"("sourceOrganizationId", "targetOrganizationId");
