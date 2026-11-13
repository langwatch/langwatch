-- IRREVERSIBLE: creates new tables; migrations never drop one, a drop is an operator step.
-- Ops agent access (ADR-202), owned by the staff-access module: enrolled agents, their passkey
-- challenges, approval requests with the one-hour sessions they become, and the call trail.
CREATE TABLE IF NOT EXISTS "StaffAccessRequester" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lookupId" TEXT NOT NULL,
    "hashedSecret" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffAccessRequester_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StaffAccessChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffAccessChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StaffAccessRequest" (
    "id" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "scopes" TEXT[],
    "organizationId" TEXT,
    "organizationName" TEXT,
    "reason" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "requestIp" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "spendApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvalCredentialId" TEXT,
    "approvalSignature" TEXT,
    "signedHash" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "pinnedIp" TEXT,
    "apiKeyId" TEXT,
    "hashedOpsToken" TEXT,
    "opsTokenLookupId" TEXT,
    "accessExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeCause" TEXT,
    "endAuditedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffAccessRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StaffAccessEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "permissions" TEXT[],
    "organizationId" TEXT,
    "projectId" TEXT,
    "status" INTEGER,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "StaffAccessEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StaffAccessRequester_lookupId_key" ON "StaffAccessRequester"("lookupId");
CREATE INDEX IF NOT EXISTS "StaffAccessRequester_ownerUserId_idx" ON "StaffAccessRequester"("ownerUserId");
CREATE INDEX IF NOT EXISTS "StaffAccessChallenge_userId_purpose_idx" ON "StaffAccessChallenge"("userId", "purpose");
CREATE UNIQUE INDEX IF NOT EXISTS "StaffAccessRequest_apiKeyId_key" ON "StaffAccessRequest"("apiKeyId");
CREATE UNIQUE INDEX IF NOT EXISTS "StaffAccessRequest_opsTokenLookupId_key" ON "StaffAccessRequest"("opsTokenLookupId");
CREATE INDEX IF NOT EXISTS "StaffAccessRequest_requesterId_createdAt_idx" ON "StaffAccessRequest"("requesterId", "createdAt");
CREATE INDEX IF NOT EXISTS "StaffAccessRequest_status_accessExpiresAt_idx" ON "StaffAccessRequest"("status", "accessExpiresAt");
CREATE INDEX IF NOT EXISTS "StaffAccessRequest_createdAt_idx" ON "StaffAccessRequest"("createdAt");
CREATE INDEX IF NOT EXISTS "StaffAccessEvent_requestId_at_idx" ON "StaffAccessEvent"("requestId", "at");
