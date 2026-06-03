-- SsoConnection was introduced earlier in this PR (hand-rolled per-org OIDC)
-- and never shipped to production. It is replaced by SsoProvider, which is
-- backed by the @better-auth/sso plugin (OIDC + SAML). Dropping is safe: no
-- production data exists. `IF EXISTS` keeps this idempotent across dev DBs that
-- never applied the original SsoConnection migration.
DROP TABLE IF EXISTS "SsoConnection";

-- CreateTable
CREATE TABLE "SsoProvider" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "oidcConfig" TEXT,
    "samlConfig" TEXT,
    "userId" TEXT,
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "domain" TEXT NOT NULL,
    "domainVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationToken" TEXT NOT NULL,
    "ssoEnforced" BOOLEAN NOT NULL DEFAULT false,
    "jitProvisioning" BOOLEAN NOT NULL DEFAULT false,
    "defaultOrgRole" "OrganizationUserRole" NOT NULL DEFAULT 'MEMBER',
    "roleMapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SsoProvider_providerId_key" ON "SsoProvider"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "SsoProvider_verificationToken_key" ON "SsoProvider"("verificationToken");

-- CreateIndex
CREATE INDEX "SsoProvider_organizationId_idx" ON "SsoProvider"("organizationId");

-- CreateIndex
CREATE INDEX "SsoProvider_domain_idx" ON "SsoProvider"("domain");
