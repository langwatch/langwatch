-- A Slack connection in use is claimed, not counted (ARCHITECTURE.md §3, the
-- claims ruling of 2026-09-30). Automation claims a connection when it saves a
-- trigger on it and releases it when the trigger moves off, pauses or is
-- deleted; a claimed connection cannot be deleted (ON DELETE RESTRICT).
-- projectId is the claimant's project; organizationId the tenancy anchor.

-- CreateTable
CREATE TABLE "slack_connection_claim" (
    "connectionId" TEXT NOT NULL,
    "claimantId" TEXT NOT NULL,
    "claimantLabel" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slack_connection_claim_pkey" PRIMARY KEY ("connectionId","claimantId")
);

-- CreateIndex
CREATE INDEX "slack_connection_claim_organizationId_idx" ON "slack_connection_claim"("organizationId");

-- AddForeignKey
ALTER TABLE "slack_connection_claim" ADD CONSTRAINT "slack_connection_claim_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SlackIntegration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
