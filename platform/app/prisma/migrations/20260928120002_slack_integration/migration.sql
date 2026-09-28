-- Named Slack connections (ADR-093 §5a). An organization holds any number,
-- each scoped to the whole organization or to one project, and each either a
-- bot token (Web API) or an incoming webhook URL. Automations point at one by
-- id instead of carrying their own copy of the credential.
--
-- Shape follows ADR-021's single-scope-per-row storage: inline
-- (scopeType, scopeId) plus the organizationId tenancy anchor. No foreign key,
-- because scopeId is polymorphic (an Organization.id or a Project.id).
--
-- botTokenEncrypted / webhookUrlEncrypted hold encrypt() ciphertext
-- (AES-256-GCM, CREDENTIALS_SECRET); exactly one is set, matching kind, and
-- neither is ever read back to a client. The ciphertext has a random IV, so
-- secretFingerprint (an HMAC of the plaintext) is what makes one secret one
-- connection per organization: the unique index is the merge rule.
-- secretHint is the last four characters, for display. slackTeamId /
-- slackTeamName are what auth.test returned for a bot token; null for webhooks.

-- CreateEnum
CREATE TYPE "SlackIntegrationScopeType" AS ENUM ('ORGANIZATION', 'PROJECT');

-- CreateEnum
CREATE TYPE "SlackIntegrationKind" AS ENUM ('BOT', 'INCOMING_WEBHOOK');

-- CreateTable
CREATE TABLE "SlackIntegration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SlackIntegrationKind" NOT NULL,
    "scopeType" "SlackIntegrationScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "botTokenEncrypted" TEXT,
    "webhookUrlEncrypted" TEXT,
    "secretFingerprint" TEXT NOT NULL,
    "secretHint" TEXT NOT NULL,
    "slackTeamId" TEXT,
    "slackTeamName" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlackIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SlackIntegration_organizationId_secretFingerprint_key" ON "SlackIntegration"("organizationId", "secretFingerprint");

-- CreateIndex
CREATE INDEX "SlackIntegration_scopeType_scopeId_idx" ON "SlackIntegration"("scopeType", "scopeId");

-- To roll back, uncomment and run manually.
-- Down (manual): dropping the table deletes every stored Slack connection;
-- automations pointing at one stop delivering until reconnected.
-- DROP TABLE "SlackIntegration";
-- DROP TYPE "SlackIntegrationKind";
-- DROP TYPE "SlackIntegrationScopeType";
