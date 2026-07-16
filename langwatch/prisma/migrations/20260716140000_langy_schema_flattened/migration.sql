-- Consolidated Langy schema additions.
--
-- This migration is additive and safe to deploy after any subset of the
-- pre-release Langy migrations. Historical migrations remain in the tree so
-- Prisma's production migration ledger is never rewritten or flattened away.

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "langyEgressAllowlist" JSONB;

DO $$ BEGIN
  CREATE TYPE "LangyProjectionTitleSource" AS ENUM ('derived', 'auto', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LangyProjectionTurnStatus" AS ENUM ('pending', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ProcessManagerOutboxStatus" AS ENUM ('pending', 'dispatched', 'dead');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "LangyConversationProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT,
  "titleSource" "LangyProjectionTitleSource" NOT NULL,
  "status" TEXT NOT NULL,
  "isShared" BOOLEAN NOT NULL DEFAULT false,
  "sharedAt" DOUBLE PRECISION,
  "sharedById" TEXT,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "lastActivityAt" DOUBLE PRECISION,
  "currentTurnId" TEXT,
  "lastError" TEXT,
  "pendingHandoffToken" TEXT,
  "pendingHandoffTurnId" TEXT,
  "runToken" TEXT,
  "archivedAt" DOUBLE PRECISION,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "lastEventId" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  CONSTRAINT "LangyConversationProjection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LangyConversationTurnProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "status" "LangyProjectionTurnStatus" NOT NULL,
  "questionParts" JSONB NOT NULL,
  "answerParts" JSONB NOT NULL,
  "toolCalls" JSONB NOT NULL,
  "plan" JSONB,
  "error" TEXT,
  "startedAt" DOUBLE PRECISION,
  "endedAt" DOUBLE PRECISION,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "lastEventId" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  CONSTRAINT "LangyConversationTurnProjection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LangyMessageProjection" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "parts" JSONB NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "occurredAt" DOUBLE PRECISION NOT NULL,
  "acceptedAt" DOUBLE PRECISION NOT NULL,
  "createdAt" DOUBLE PRECISION NOT NULL,
  "updatedAt" DOUBLE PRECISION NOT NULL,
  CONSTRAINT "LangyMessageProjection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LangyConversationProjection_projectId_conversationId_key"
  ON "LangyConversationProjection"("projectId", "conversationId");
CREATE INDEX IF NOT EXISTS "LangyConversationProjection_projectId_userId_conversationId_idx"
  ON "LangyConversationProjection"("projectId", "userId", "conversationId");
CREATE INDEX IF NOT EXISTS "LangyConversationProjection_projectId_userId_lastActivityAt_idx"
  ON "LangyConversationProjection"("projectId", "userId", "lastActivityAt");
CREATE UNIQUE INDEX IF NOT EXISTS "LangyConversationTurnProjection_projectId_conversationId_turnId_key"
  ON "LangyConversationTurnProjection"("projectId", "conversationId", "turnId");
CREATE INDEX IF NOT EXISTS "LangyConversationTurnProjection_projectId_conversationId_updatedAt_idx"
  ON "LangyConversationTurnProjection"("projectId", "conversationId", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "LangyMessageProjection_projectId_conversationId_messageId_key"
  ON "LangyMessageProjection"("projectId", "conversationId", "messageId");
CREATE UNIQUE INDEX IF NOT EXISTS "LangyMessageProjection_projectId_sourceEventId_key"
  ON "LangyMessageProjection"("projectId", "sourceEventId");
CREATE INDEX IF NOT EXISTS "LangyMessageProjection_projectId_conversationId_createdAt_idx"
  ON "LangyMessageProjection"("projectId", "conversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "LangyGithubInstallation" (
  "id" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "accountLogin" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "repositorySelection" TEXT NOT NULL,
  "repositories" JSONB,
  "suspendedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LangyGithubInstallation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LangyGithubInstallation_installationId_key"
  ON "LangyGithubInstallation"("installationId");
CREATE INDEX IF NOT EXISTS "LangyGithubInstallation_organizationId_idx"
  ON "LangyGithubInstallation"("organizationId");

CREATE TABLE IF NOT EXISTS "ProcessManagerInstance" (
  "id" TEXT NOT NULL,
  "processName" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "processKey" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "state" JSONB NOT NULL,
  "revision" INTEGER NOT NULL,
  "nextWakeAt" TIMESTAMPTZ(3),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProcessManagerInstance_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ProcessManagerInbox" (
  "id" TEXT NOT NULL,
  "processName" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "processKey" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "sourceEventId" TEXT NOT NULL,
  "consumedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProcessManagerInbox_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ProcessManagerOutbox" (
  "id" TEXT NOT NULL,
  "processName" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "processKey" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "messageKey" TEXT NOT NULL,
  "intentType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "traceCarrier" JSONB NOT NULL,
  "sourceEventId" TEXT,
  "status" "ProcessManagerOutboxStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
  "leasedUntil" TIMESTAMPTZ(3),
  "leaseToken" TEXT,
  "dispatchedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProcessManagerOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProcessManagerInstance_processName_projectId_processKey_key"
  ON "ProcessManagerInstance"("processName", "projectId", "processKey");
CREATE INDEX IF NOT EXISTS "ProcessManagerInstance_nextWakeAt_idx"
  ON "ProcessManagerInstance"("nextWakeAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ProcessManagerInbox_processName_projectId_sourceEventId_key"
  ON "ProcessManagerInbox"("processName", "projectId", "sourceEventId");
CREATE INDEX IF NOT EXISTS "ProcessManagerInbox_processName_projectId_processKey_consumedAt_idx"
  ON "ProcessManagerInbox"("processName", "projectId", "processKey", "consumedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ProcessManagerOutbox_processName_projectId_messageKey_key"
  ON "ProcessManagerOutbox"("processName", "projectId", "messageKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ProcessManagerOutbox_leaseToken_key"
  ON "ProcessManagerOutbox"("leaseToken");
CREATE INDEX IF NOT EXISTS "ProcessManagerOutbox_processName_projectId_processKey_createdAt_idx"
  ON "ProcessManagerOutbox"("processName", "projectId", "processKey", "createdAt");
CREATE INDEX IF NOT EXISTS "ProcessManagerOutbox_status_nextAttemptAt_leasedUntil_idx"
  ON "ProcessManagerOutbox"("status", "nextAttemptAt", "leasedUntil");

CREATE TABLE IF NOT EXISTS "LangyTurnRequest" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "leaseOwner" TEXT NOT NULL,
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LangyTurnRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "LangyActiveTurn" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "turnId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "leaseOwner" TEXT NOT NULL,
  "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LangyActiveTurn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LangyTurnRequest_projectId_userId_requestId_key"
  ON "LangyTurnRequest"("projectId", "userId", "requestId");
CREATE INDEX IF NOT EXISTS "LangyTurnRequest_projectId_conversationId_idx"
  ON "LangyTurnRequest"("projectId", "conversationId");
CREATE UNIQUE INDEX IF NOT EXISTS "LangyActiveTurn_projectId_conversationId_key"
  ON "LangyActiveTurn"("projectId", "conversationId");
CREATE INDEX IF NOT EXISTS "LangyActiveTurn_projectId_userId_idx"
  ON "LangyActiveTurn"("projectId", "userId");
