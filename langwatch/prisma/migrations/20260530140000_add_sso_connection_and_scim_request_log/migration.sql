-- CreateTable
CREATE TABLE "SsoConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "provider" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEnc" TEXT NOT NULL,
    "issuerUrl" TEXT,
    "tenantId" TEXT,
    "samlEntityId" TEXT,
    "samlSsoUrl" TEXT,
    "samlCertificate" TEXT,
    "attributeMapping" JSONB,
    "roleMapping" JSONB,
    "ssoEnforced" BOOLEAN NOT NULL DEFAULT false,
    "jitProvisioning" BOOLEAN NOT NULL DEFAULT false,
    "defaultOrgRole" "OrganizationUserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimRequestLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestMethod" TEXT NOT NULL,
    "requestPath" TEXT NOT NULL,
    "requestHeaders" JSONB,
    "requestBody" JSONB,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB,
    "identityProvider" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SsoConnection_verificationToken_key" ON "SsoConnection"("verificationToken");

-- CreateIndex
CREATE INDEX "SsoConnection_organizationId_idx" ON "SsoConnection"("organizationId");

-- CreateIndex
CREATE INDEX "SsoConnection_domain_idx" ON "SsoConnection"("domain");

-- CreateIndex
CREATE INDEX "ScimRequestLog_organizationId_createdAt_idx" ON "ScimRequestLog"("organizationId", "createdAt");

-- Partial unique index: only one org can be VERIFIED for a given domain.
-- Multiple orgs can have PENDING claims (verifiedAt IS NULL).
CREATE UNIQUE INDEX "SsoConnection_domain_verified" ON "SsoConnection" ("domain") WHERE "verifiedAt" IS NOT NULL;
