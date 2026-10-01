-- The SSO connection pipeline's projection (ADR-117 §5, D04 - see
-- specs/identity/sso-connection-lifecycle.feature). Additive and dark:
-- SSOCONN_ROUTING ships `off`, so nothing routes off this table and no
-- `Organization.ssoDomain` write stops. The grandfather migration is its only
-- production writer until D05's self-service, paced by the same
-- per-organization enrollment every other in-place migration is.
--
-- A pure event-truth head, like Identifier: fold-written, never deleted
-- (TORN_DOWN is a tombstone), and rebuilt whole-row by a replay. The fold
-- cursor sits on the row because one row IS one aggregate here.
--
-- To roll back, uncomment and run manually. Dropping the table loses only
-- fold-written projection state, which replay rebuilds from the event log.
-- DROP TABLE "SsoConnection";

-- CreateTable
CREATE TABLE "SsoConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "claimedDomains" TEXT[],
    "approvedDomains" TEXT[],
    "verifiedDomains" TEXT[],
    "pendingVerification" JSONB,
    "idpMetadata" JSONB NOT NULL,
    "allowsJit" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "testLoginAccountId" TEXT,
    "rejection" JSONB,
    "createdBy" TEXT,
    "tearDownAfter" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    -- Event-derived, not database-managed: a default or an ON UPDATE would
    -- make a replayed row differ from the row it rebuilds.
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SsoConnection_organizationId_idx" ON "SsoConnection"("organizationId");

-- CreateIndex
CREATE INDEX "SsoConnection_state_idx" ON "SsoConnection"("state");

-- CreateIndex
-- The sign-in hot path's read: which connection has verified this domain.
-- GIN, because the predicate is array containment and a btree cannot serve it.
CREATE INDEX "SsoConnection_verifiedDomains_idx" ON "SsoConnection" USING GIN ("verifiedDomains");
