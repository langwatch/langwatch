-- IRREVERSIBLE: no down step. Additive only: one new table and one defaulted column, which the
-- image still serving neither reads nor writes. Dropping the table would lose the index of every
-- diagnostics bundle Cloud still holds in object storage.

-- One row per upgrade diagnostics bundle a self-hosted install sent over Connect
-- (dev/docs/plans/upgrade-diagnostics-via-connect.md). No foreign key, per the database rule.
CREATE TABLE IF NOT EXISTS "SelfHostedInstanceDiagnostic" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "stepDescription" TEXT,
    "release" TEXT,
    "attempt" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "slackAnnouncedAt" TIMESTAMP(3),

    CONSTRAINT "SelfHostedInstanceDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SelfHostedInstanceDiagnostic_instanceId_receivedAt_idx" ON "SelfHostedInstanceDiagnostic"("instanceId", "receivedAt");

-- The operator's switch for sending a failed step's diagnostics automatically (decision 4).
ALTER TABLE "InstanceIdentity" ADD COLUMN IF NOT EXISTS "upgradeDiagnosticsOptOut" BOOLEAN NOT NULL DEFAULT false;
