-- AI Gateway initial schema
-- Contract source: specs/ai-gateway/_shared/contract.md (v0.1)

-- Enums ---------------------------------------------------------------------

CREATE TYPE "VirtualKeyEnvironment" AS ENUM ('LIVE', 'TEST');

CREATE TYPE "VirtualKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TYPE "GatewayProviderRotationPolicy" AS ENUM ('AUTO', 'MANUAL', 'EXTERNAL_SECRET_STORE');

CREATE TYPE "GatewayProviderHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'CIRCUIT_OPEN');

CREATE TYPE "GatewayBudgetScopeType" AS ENUM (
    'ORGANIZATION',
    'TEAM',
    'PROJECT',
    'VIRTUAL_KEY',
    'PRINCIPAL'
);

CREATE TYPE "GatewayBudgetWindow" AS ENUM (
    'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'TOTAL'
);

CREATE TYPE "GatewayBudgetBreachAction" AS ENUM ('BLOCK', 'WARN');

CREATE TYPE "GatewayBudgetLedgerStatus" AS ENUM (
    'SUCCESS', 'PROVIDER_ERROR', 'BLOCKED_BY_GUARDRAIL', 'CANCELLED'
);

CREATE TYPE "GatewayChangeEventKind" AS ENUM (
    'VK_CREATED',
    'VK_CONFIG_UPDATED',
    'VK_REVOKED',
    'VK_ROTATED',
    'BUDGET_CREATED',
    'BUDGET_UPDATED',
    'BUDGET_DELETED',
    'PROVIDER_BINDING_UPDATED'
);

CREATE TYPE "GatewayAuditAction" AS ENUM (
    'VIRTUAL_KEY_CREATED',
    'VIRTUAL_KEY_UPDATED',
    'VIRTUAL_KEY_ROTATED',
    'VIRTUAL_KEY_REVOKED',
    'VIRTUAL_KEY_DELETED',
    'BUDGET_CREATED',
    'BUDGET_UPDATED',
    'BUDGET_DELETED',
    'PROVIDER_BINDING_CREATED',
    'PROVIDER_BINDING_UPDATED',
    'PROVIDER_BINDING_DELETED'
);

-- VirtualKey ----------------------------------------------------------------

CREATE TABLE "VirtualKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "environment" "VirtualKeyEnvironment" NOT NULL DEFAULT 'LIVE',
    "status" "VirtualKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "hashedSecret" TEXT NOT NULL,
    "displayPrefix" TEXT NOT NULL,
    "principalUserId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "revision" BIGINT NOT NULL DEFAULT 0,
    "previousHashedSecret" TEXT,
    "previousSecretValidUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "VirtualKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VirtualKey_projectId_name_key" ON "VirtualKey"("projectId", "name");
CREATE UNIQUE INDEX "VirtualKey_hashedSecret_key" ON "VirtualKey"("hashedSecret");
CREATE INDEX "VirtualKey_projectId_idx" ON "VirtualKey"("projectId");
CREATE INDEX "VirtualKey_displayPrefix_idx" ON "VirtualKey"("displayPrefix");
CREATE INDEX "VirtualKey_status_idx" ON "VirtualKey"("status");
CREATE INDEX "VirtualKey_principalUserId_idx" ON "VirtualKey"("principalUserId");
CREATE INDEX "VirtualKey_revision_idx" ON "VirtualKey"("revision");

-- GatewayProviderCredential -------------------------------------------------

CREATE TABLE "GatewayProviderCredential" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "modelProviderId" TEXT NOT NULL,
    "slot" TEXT NOT NULL DEFAULT 'primary',
    "rateLimitRpm" INTEGER,
    "rateLimitTpm" INTEGER,
    "rateLimitRpd" INTEGER,
    "rotationPolicy" "GatewayProviderRotationPolicy" NOT NULL DEFAULT 'MANUAL',
    "extraHeaders" JSONB,
    "fallbackPriorityGlobal" INTEGER,
    "providerConfig" JSONB,
    "healthStatus" "GatewayProviderHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
    "circuitOpenedAt" TIMESTAMP(3),
    "lastHealthCheckAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GatewayProviderCredential_projectId_modelProviderId_slot_key"
    ON "GatewayProviderCredential"("projectId", "modelProviderId", "slot");
CREATE INDEX "GatewayProviderCredential_projectId_idx" ON "GatewayProviderCredential"("projectId");
CREATE INDEX "GatewayProviderCredential_modelProviderId_idx" ON "GatewayProviderCredential"("modelProviderId");
CREATE INDEX "GatewayProviderCredential_healthStatus_idx" ON "GatewayProviderCredential"("healthStatus");

-- VirtualKeyProviderCredential (join + priority) ----------------------------

CREATE TABLE "VirtualKeyProviderCredential" (
    "virtualKeyId" TEXT NOT NULL,
    "providerCredentialId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "overrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualKeyProviderCredential_pkey" PRIMARY KEY ("virtualKeyId", "providerCredentialId")
);

CREATE UNIQUE INDEX "VirtualKeyProviderCredential_vk_priority_key"
    ON "VirtualKeyProviderCredential"("virtualKeyId", "priority");
CREATE INDEX "VirtualKeyProviderCredential_providerCredentialId_idx"
    ON "VirtualKeyProviderCredential"("providerCredentialId");

-- GatewayBudget -------------------------------------------------------------

CREATE TABLE "GatewayBudget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeType" "GatewayBudgetScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "organizationScopedId" TEXT,
    "teamScopedId" TEXT,
    "projectScopedId" TEXT,
    "virtualKeyScopedId" TEXT,
    "principalUserId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "window" "GatewayBudgetWindow" NOT NULL,
    "limitUsd" DECIMAL(18, 6) NOT NULL,
    "onBreach" "GatewayBudgetBreachAction" NOT NULL DEFAULT 'BLOCK',
    "timezone" TEXT,
    "spentUsd" DECIMAL(18, 6) NOT NULL DEFAULT 0,
    "currentPeriodStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetsAt" TIMESTAMP(3) NOT NULL,
    "lastResetAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "GatewayBudget_pkey" PRIMARY KEY ("id"),
    -- exactly one typed scope column is set, matching scopeType
    CONSTRAINT "GatewayBudget_scope_check" CHECK (
        (
            ("scopeType" = 'ORGANIZATION' AND "organizationScopedId" IS NOT NULL
                AND "teamScopedId" IS NULL AND "projectScopedId" IS NULL
                AND "virtualKeyScopedId" IS NULL AND "principalUserId" IS NULL)
         OR ("scopeType" = 'TEAM' AND "teamScopedId" IS NOT NULL
                AND "organizationScopedId" IS NULL AND "projectScopedId" IS NULL
                AND "virtualKeyScopedId" IS NULL AND "principalUserId" IS NULL)
         OR ("scopeType" = 'PROJECT' AND "projectScopedId" IS NOT NULL
                AND "organizationScopedId" IS NULL AND "teamScopedId" IS NULL
                AND "virtualKeyScopedId" IS NULL AND "principalUserId" IS NULL)
         OR ("scopeType" = 'VIRTUAL_KEY' AND "virtualKeyScopedId" IS NOT NULL
                AND "organizationScopedId" IS NULL AND "teamScopedId" IS NULL
                AND "projectScopedId" IS NULL AND "principalUserId" IS NULL)
         OR ("scopeType" = 'PRINCIPAL' AND "principalUserId" IS NOT NULL
                AND "organizationScopedId" IS NULL AND "teamScopedId" IS NULL
                AND "projectScopedId" IS NULL AND "virtualKeyScopedId" IS NULL)
        )
    )
);

CREATE INDEX "GatewayBudget_organizationId_idx" ON "GatewayBudget"("organizationId");
CREATE INDEX "GatewayBudget_scope_idx" ON "GatewayBudget"("scopeType", "scopeId");
CREATE INDEX "GatewayBudget_resetsAt_idx" ON "GatewayBudget"("resetsAt");

-- GatewayBudgetLedger -------------------------------------------------------

CREATE TABLE "GatewayBudgetLedger" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "virtualKeyId" TEXT NOT NULL,
    "providerCredentialId" TEXT,
    "gatewayRequestId" TEXT NOT NULL,
    "amountUsd" DECIMAL(18, 6) NOT NULL,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheRead" INTEGER NOT NULL DEFAULT 0,
    "tokensCacheWrite" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL,
    "providerSlot" TEXT,
    "durationMs" INTEGER,
    "status" "GatewayBudgetLedgerStatus" NOT NULL DEFAULT 'SUCCESS',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayBudgetLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GatewayBudgetLedger_budget_request_key"
    ON "GatewayBudgetLedger"("budgetId", "gatewayRequestId");
CREATE INDEX "GatewayBudgetLedger_virtualKeyId_idx" ON "GatewayBudgetLedger"("virtualKeyId");
CREATE INDEX "GatewayBudgetLedger_gatewayRequestId_idx" ON "GatewayBudgetLedger"("gatewayRequestId");
CREATE INDEX "GatewayBudgetLedger_occurredAt_idx" ON "GatewayBudgetLedger"("occurredAt");

-- GatewayChangeEvent (long-poll revision feed) ------------------------------

CREATE TABLE "GatewayChangeEvent" (
    "revision" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "GatewayChangeEventKind" NOT NULL,
    "virtualKeyId" TEXT,
    "budgetId" TEXT,
    "providerCredentialId" TEXT,
    "projectId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayChangeEvent_pkey" PRIMARY KEY ("revision")
);

CREATE INDEX "GatewayChangeEvent_organizationId_revision_idx"
    ON "GatewayChangeEvent"("organizationId", "revision");
CREATE INDEX "GatewayChangeEvent_projectId_revision_idx"
    ON "GatewayChangeEvent"("projectId", "revision");
CREATE INDEX "GatewayChangeEvent_virtualKeyId_idx" ON "GatewayChangeEvent"("virtualKeyId");
CREATE INDEX "GatewayChangeEvent_budgetId_idx" ON "GatewayChangeEvent"("budgetId");

-- GatewayAuditLog -----------------------------------------------------------

CREATE TABLE "GatewayAuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "actorUserId" TEXT,
    "action" "GatewayAuditAction" NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GatewayAuditLog_organizationId_createdAt_idx"
    ON "GatewayAuditLog"("organizationId", "createdAt");
CREATE INDEX "GatewayAuditLog_projectId_createdAt_idx"
    ON "GatewayAuditLog"("projectId", "createdAt");
CREATE INDEX "GatewayAuditLog_actorUserId_idx" ON "GatewayAuditLog"("actorUserId");
CREATE INDEX "GatewayAuditLog_targetKind_targetId_idx"
    ON "GatewayAuditLog"("targetKind", "targetId");

-- Down migrations intentionally omitted.
-- To roll back, drop the tables and enums manually (dev only).
