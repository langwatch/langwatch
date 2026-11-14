-- IRREVERSIBLE: creates the "NurturingPersonalProject" and "NurturingTracedProject" tables.
-- A rollback leaves them in place; dropping them is an operator step confirmed in Ops.
-- Nurturing's own copies of personal owners and traced projects, written from owners' facts
-- (enterprise/modules/nurturing/specs/project-facts-copies.feature).
CREATE TABLE IF NOT EXISTS "NurturingPersonalProject" (
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,

    CONSTRAINT "NurturingPersonalProject_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NurturingTracedProject" (
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "NurturingTracedProject_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NurturingTracedProject_organizationId_idx" ON "NurturingTracedProject"("organizationId");
