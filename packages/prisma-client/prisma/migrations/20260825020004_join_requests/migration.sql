-- Join requests and domain auto-join (ADR-117, D12 - see
-- specs/identity/join-requests.feature, join-matching-and-privacy.feature,
-- domain-auto-join.feature, join-before-create.feature). Additive and dark:
-- JOIN_REQUESTS ships off, so nothing dispatches a join command, no
-- interstitial renders and no admin panel appears. A deploy changes nothing
-- on its own; rollback is the flag.
--
-- Two parts:
--
--   1. `JoinRequest` - the pipeline's projection. A pure event-truth head,
--      like Identifier and SsoConnection: fold-written, never deleted (a
--      terminal state is a tombstone the panel stops listing), and rebuilt
--      whole-row by a replay. The fold cursor sits on the row because one row
--      IS one aggregate here. Membership is NOT here - an approval attaches
--      on the grants ledger with `source: "join-request"`, which is what puts
--      it on the customer's audit page.
--
--   2. `Organization.domainJoin` / `.joinDomains` - how an organization has
--      set joining. Every existing organization lands on `request`, which is
--      the self-serve default and is INERT while the flag is off: nothing
--      reads it, nothing is offered, and no organization becomes visible to
--      a stranger because this column exists. `joinDomains` starts empty, so
--      automatic joining admits nobody until an administrator names a domain.
--
-- To roll back, uncomment and run manually. Dropping the table loses only
-- fold-written projection state, which replay rebuilds from the event log;
-- dropping the columns loses an organization's stated preference.
-- DROP TABLE "JoinRequest";
-- ALTER TABLE "Organization" DROP COLUMN "domainJoin", DROP COLUMN "joinDomains";

-- CreateTable
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "matchedVia" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByType" TEXT,
    "resolvedById" TEXT,
    "withdrawalCause" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    -- Event-derived, not database-managed: a default or an ON UPDATE would
    -- make a replayed row differ from the row it rebuilds.
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The admin panel's read: what is waiting on this organization.
CREATE INDEX "JoinRequest_organizationId_state_idx" ON "JoinRequest"("organizationId", "state");

-- CreateIndex
-- The requester's own read: am I waiting on anybody.
CREATE INDEX "JoinRequest_userId_state_idx" ON "JoinRequest"("userId", "state");

-- CreateIndex
-- The duplicate-suppression read: one open request per person per organization.
CREATE INDEX "JoinRequest_userId_organizationId_idx" ON "JoinRequest"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "JoinRequest_domain_idx" ON "JoinRequest"("domain");

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "domainJoin" TEXT NOT NULL DEFAULT 'request',
ADD COLUMN     "joinDomains" TEXT[];
