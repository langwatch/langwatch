-- Identity SSO, SCIM, domain proof, and legacy Auth0 replacement cutover.

ALTER TABLE "User" ADD COLUMN "joinOfferDismissedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TYPE "SsoConnectionMigrationPhase" AS ENUM (
  'SETUP', 'GRACE_LEGACY', 'GRACE_DIRECT', 'FINALIZING', 'FINALIZED'
);

ALTER TABLE "SsoConnection"
  ADD COLUMN "arrivalPolicy" TEXT NOT NULL DEFAULT 'refuse',
  ADD COLUMN "arrivalPolicyDecidedAt" TIMESTAMP(3),
  ADD COLUMN "domainClaims" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "lapsedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "replacesConnectionId" TEXT,
  ADD COLUMN "migrationPhase" "SsoConnectionMigrationPhase",
  ADD COLUMN "graceStartedAt" TIMESTAMP(3),
  ADD COLUMN "routeChangedAt" TIMESTAMP(3),
  ADD COLUMN "finalizationRequestedAt" TIMESTAMP(3),
  ADD COLUMN "finalizedAt" TIMESTAMP(3);

CREATE INDEX "SsoConnection_organizationId_migrationPhase_idx" ON "SsoConnection"("organizationId", "migrationPhase");
CREATE INDEX "SsoConnection_lapsedDomains_idx" ON "SsoConnection" USING GIN ("lapsedDomains");
CREATE UNIQUE INDEX "SsoConnection_one_live_legacy_per_org" ON "SsoConnection"("organizationId")
  WHERE "source" = 'legacy-grandfathered' AND "state" NOT IN ('DISCARDED', 'TORN_DOWN');
CREATE UNIQUE INDEX "SsoConnection_one_live_direct_per_org" ON "SsoConnection"("organizationId")
  WHERE "source" <> 'legacy-grandfathered' AND "state" NOT IN ('DISCARDED', 'TORN_DOWN');
CREATE UNIQUE INDEX "SsoConnection_one_live_replacement_per_predecessor" ON "SsoConnection"("replacesConnectionId")
  WHERE "replacesConnectionId" IS NOT NULL AND "state" NOT IN ('DISCARDED', 'TORN_DOWN');

CREATE TABLE "SsoConnectionRegistrationSlot" (
  "organizationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "replacesConnectionId" TEXT,
  "commandId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoConnectionRegistrationSlot_pkey" PRIMARY KEY ("organizationId", "kind")
);
CREATE UNIQUE INDEX "SsoConnectionRegistrationSlot_connectionId_key"
  ON "SsoConnectionRegistrationSlot"("connectionId");

-- Reserve every pre-existing live connection before accepting new commands.
-- If historical data already contains two live connections in one slot this
-- intentionally fails deployment for operator repair; silently choosing one
-- would make the other connection disappear from the concurrency invariant.
INSERT INTO "SsoConnectionRegistrationSlot" (
  "organizationId", "kind", "connectionId", "replacesConnectionId",
  "commandId", "createdAt", "updatedAt"
)
SELECT
  "organizationId",
  CASE WHEN "source" = 'legacy-grandfathered' THEN 'legacy' ELSE 'direct' END,
  "id",
  "replacesConnectionId",
  'backfill:' || "id",
  "createdAt",
  "updatedAt"
FROM "SsoConnection"
WHERE "state" NOT IN ('DISCARDED', 'TORN_DOWN');

CREATE TABLE "SsoVerifiedDomain" (
  "domain" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  CONSTRAINT "SsoVerifiedDomain_pkey" PRIMARY KEY ("domain")
);
CREATE UNIQUE INDEX "SsoVerifiedDomain_domain_organizationId_key" ON "SsoVerifiedDomain"("domain", "organizationId");
CREATE INDEX "SsoVerifiedDomain_organizationId_idx" ON "SsoVerifiedDomain"("organizationId");

CREATE TABLE "SsoVerifiedDomainHolder" (
  "domain" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  CONSTRAINT "SsoVerifiedDomainHolder_pkey" PRIMARY KEY ("domain", "connectionId"),
  CONSTRAINT "SsoVerifiedDomainHolder_owner_fkey" FOREIGN KEY ("domain", "organizationId")
    REFERENCES "SsoVerifiedDomain"("domain", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SsoVerifiedDomainHolder_connectionId_idx" ON "SsoVerifiedDomainHolder"("connectionId");
CREATE INDEX "SsoVerifiedDomainHolder_organizationId_idx" ON "SsoVerifiedDomainHolder"("organizationId");

CREATE TABLE "SsoAuthenticationActivity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "authenticatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SsoAuthenticationActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SsoAuthenticationActivity_organizationId_connectionId_authenticatedAt_idx"
  ON "SsoAuthenticationActivity"("organizationId", "connectionId", "authenticatedAt");
CREATE INDEX "SsoAuthenticationActivity_organizationId_userId_idx"
  ON "SsoAuthenticationActivity"("organizationId", "userId");

CREATE TABLE "SsoConnectionReproofCursor" (
  "connectionId" TEXT NOT NULL,
  "lastReproofAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SsoConnectionReproofCursor_pkey" PRIMARY KEY ("connectionId")
);
CREATE INDEX "SsoConnectionReproofCursor_lastReproofAt_idx" ON "SsoConnectionReproofCursor"("lastReproofAt");

CREATE TABLE "SsoCredential" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SsoCredential_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SsoCredential_organizationId_connectionId_idx" ON "SsoCredential"("organizationId", "connectionId");

CREATE TABLE "SsoProvider" (
  "id" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "oidcConfig" TEXT,
  "samlConfig" TEXT,
  "userId" TEXT,
  "providerId" TEXT NOT NULL,
  "organizationId" TEXT,
  "domain" TEXT NOT NULL,
  CONSTRAINT "SsoProvider_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SsoProvider_providerId_key" ON "SsoProvider"("providerId");
CREATE INDEX "SsoProvider_organizationId_idx" ON "SsoProvider"("organizationId");
CREATE INDEX "SsoProvider_domain_idx" ON "SsoProvider"("domain");

CREATE TABLE "SsoBreakGlassBinding" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "supersededAt" TIMESTAMP(3),
  "renewedFromId" TEXT,
  "warnedDays" INTEGER[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoBreakGlassBinding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SsoBreakGlassBinding_organizationId_expiresAt_idx" ON "SsoBreakGlassBinding"("organizationId", "expiresAt");
CREATE INDEX "SsoBreakGlassBinding_userId_idx" ON "SsoBreakGlassBinding"("userId");

CREATE TABLE "SsoActivationRecoveryReservation" (
  "commandId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SsoActivationRecoveryReservation_pkey" PRIMARY KEY ("commandId")
);
CREATE UNIQUE INDEX "SsoActivationRecoveryReservation_organizationId_connectionId_key"
  ON "SsoActivationRecoveryReservation"("organizationId", "connectionId");
CREATE INDEX "SsoActivationRecoveryReservation_organizationId_idx"
  ON "SsoActivationRecoveryReservation"("organizationId");

CREATE TABLE "ScimRequestLog" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT,
  "method" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "reason" TEXT,
  "detail" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScimRequestLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScimRequestLog_organizationId_occurredAt_idx" ON "ScimRequestLog"("organizationId", "occurredAt");
CREATE INDEX "ScimRequestLog_connectionId_occurredAt_idx" ON "ScimRequestLog"("connectionId", "occurredAt");
CREATE INDEX "ScimRequestLog_occurredAt_idx" ON "ScimRequestLog"("occurredAt");

ALTER TABLE "ScimToken" ADD COLUMN "hashScheme" TEXT NOT NULL DEFAULT 'sha256';
DROP INDEX IF EXISTS "ScimToken_hashedToken_idx";
CREATE UNIQUE INDEX "ScimToken_hashedToken_key" ON "ScimToken"("hashedToken");
