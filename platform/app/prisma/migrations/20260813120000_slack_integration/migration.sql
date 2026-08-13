-- The project's Slack workspace connection (ADR-093 section 5). Until now the
-- bot token was pasted into every automation separately: one workspace, one
-- bot, N copies of the credential, and N places to rotate it. This table holds
-- it once per project.
--
-- Shape follows ADR-021's single-scope-per-row storage: inline
-- (scopeType, scopeId) columns plus the organizationId tenancy anchor, rather
-- than a bare projectId column. PROJECT is the only scope value today, so the
-- one-integration-per-project decision is the unique constraint; widening to a
-- team- or organization-shared workspace later becomes a new enum value and new
-- rows, not a schema rework.
--
-- botTokenEncrypted holds encrypt() ciphertext (AES-256-GCM, CREDENTIALS_SECRET)
-- and is never read back to a client. slackTeamId / slackTeamName are what
-- auth.test returned when the token was saved, so the settings card can name the
-- connected workspace without touching the secret.
--
-- The datasource runs relationMode="prisma", so the organization and project
-- relations carry no SQL foreign key here; cleanup is emulated by the client.

-- CreateEnum
CREATE TYPE "SlackIntegrationScopeType" AS ENUM ('PROJECT');

-- CreateTable
CREATE TABLE "SlackIntegration" (
    "id" TEXT NOT NULL,
    "scopeType" "SlackIntegrationScopeType" NOT NULL DEFAULT 'PROJECT',
    "scopeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "botTokenEncrypted" TEXT NOT NULL,
    "slackTeamId" TEXT NOT NULL,
    "slackTeamName" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlackIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlackIntegration_scopeType_scopeId_key" ON "SlackIntegration"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "SlackIntegration_organizationId_idx" ON "SlackIntegration"("organizationId");

-- To roll back, uncomment and run manually. Dropping the table deletes every
-- connected workspace's stored token, and each project has to paste a fresh one;
-- there is no way to recover the values afterwards.
-- DROP TABLE "SlackIntegration";
-- DROP TYPE "SlackIntegrationScopeType";
