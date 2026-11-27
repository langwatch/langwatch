-- IRREVERSIBLE: creates "StaffAccessCopyLedger". A rollback leaves it in place: it is the ledger
-- that keeps a rerun from making a second target, so removing it would let reruns duplicate
-- copies. Dropping it is an operator step confirmed in Ops.
-- The organization copy ledger (staff-access module ADR-002). A row is reserved before its
-- target is made, so the target columns stay null until the copy names them.
CREATE TABLE IF NOT EXISTS "StaffAccessCopyLedger" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceOrganizationId" TEXT NOT NULL,
    "targetOrganizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT,
    "sourceProjectId" TEXT NOT NULL,
    "targetProjectId" TEXT,
    "incomplete" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffAccessCopyLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StaffAccessCopyLedger_targetOrganizationId_kind_sourceId_key" ON "StaffAccessCopyLedger"("targetOrganizationId", "kind", "sourceId");
CREATE INDEX IF NOT EXISTS "StaffAccessCopyLedger_pair_idx" ON "StaffAccessCopyLedger"("sourceOrganizationId", "targetOrganizationId");
