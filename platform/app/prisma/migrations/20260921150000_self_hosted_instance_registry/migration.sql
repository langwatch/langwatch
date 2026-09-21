-- IRREVERSIBLE: no down step. These two tables are the only record that a
-- self-hosted install exists. Dropping them would lose every install LangWatch
-- has ever heard from, and the installs themselves keep no copy. Rolling the
-- code back is safe: the tables stay unwritten and the report still reaches
-- PostHog.
--
-- Connected self-hosted (ADR-139, section 10): where the daily usage report
-- lands. Until now it reached PostHog and no database, so no screen could read
-- it back and no question about our own distribution could be answered.
--
-- `SelfHostedInstance` is one row per install, updated by every report.
-- `SelfHostedInstanceReport` is the history, one row per report.
--
-- Neither table carries an organization the report claimed. The report
-- presents no credential, so `organizationId` and `issuedLicenseId` are filled
-- from the licence bound to that instance, which the install proved by
-- presenting its token to license sync.
--
-- Additive only: two new tables, nothing else touched.

CREATE TABLE "SelfHostedInstance" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "version" TEXT,
    "installMethod" TEXT,
    "chartVersion" TEXT,
    "hostname" TEXT,
    "environment" TEXT,
    "installedAt" TIMESTAMP(3),
    "reportSchemaVersion" INTEGER,
    "organizationId" TEXT,
    "issuedLicenseId" TEXT,
    "userEmailDomains" JSONB,
    "userDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latestReport" JSONB,
    "optionalMetricsReported" BOOLEAN NOT NULL DEFAULT true,
    "hostnameReported" BOOLEAN NOT NULL DEFAULT true,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "lastUnknownFields" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfHostedInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SelfHostedInstanceReport" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT,
    "reportSchemaVersion" INTEGER,
    "unknownFields" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,

    CONSTRAINT "SelfHostedInstanceReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SelfHostedInstance_instanceId_key" ON "SelfHostedInstance"("instanceId");

CREATE INDEX "SelfHostedInstance_lastSeenAt_idx" ON "SelfHostedInstance"("lastSeenAt");

CREATE INDEX "SelfHostedInstance_organizationId_idx" ON "SelfHostedInstance"("organizationId");

CREATE INDEX "SelfHostedInstance_issuedLicenseId_idx" ON "SelfHostedInstance"("issuedLicenseId");

CREATE INDEX "SelfHostedInstanceReport_instanceId_receivedAt_idx" ON "SelfHostedInstanceReport"("instanceId", "receivedAt");

CREATE INDEX "SelfHostedInstanceReport_receivedAt_idx" ON "SelfHostedInstanceReport"("receivedAt");
