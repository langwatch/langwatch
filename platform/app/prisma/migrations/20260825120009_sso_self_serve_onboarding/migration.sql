-- Self-serve single sign-on onboarding, tiers 2 and 3 (D05 - see
-- specs/identity/sso-onboarding-tiers.feature).
--
-- Two additions, both additive:
--
-- 1. `SsoConnection.domainClaims` - every claim the connection has made,
--    where each one stands, when it was made and how long it waited. The
--    tier-3 queue is a read of this column: the epic's Open Q2 wants queue
--    latency measured from the day the queue exists, and a wait that is only
--    derivable by replaying an event log is a wait nobody measures. Like
--    `domainVerifications` next to it, the column is fold-written, a replay
--    rebuilds it, and the `[]` default is what a row folded before the
--    column existed reads as until its next event or its next replay.
--
-- 2. `SsoBreakGlassBinding` - one named person who can still sign in without
--    the identity provider while their organization's sign-in belongs to
--    one, and the date that stops. Activation asks whether such a person
--    exists, because a misconfigured connection going live is the one
--    failure that cannot be recovered from inside the product.
--
--    Rows are IMMUTABLE except for `supersededAt` and `warnedDays`: a
--    renewal writes a NEW row naming the one it replaced, so the date a way
--    in previously ended is still readable afterwards. `warnedDays` records
--    which of the fourteen, seven and one day warnings have been sent, so a
--    sweep that runs twice in a day never says the same thing twice.
--
--    No foreign keys, matching every other identity head on this schema: the
--    binding outlives the membership it was granted alongside, and a
--    cascade would erase the history of who could still get in.
--
-- To roll back, uncomment and run manually. Dropping the column loses only
-- fold-written projection state, which replay rebuilds from the event log;
-- dropping the table loses the bindings themselves, and every organization
-- whose connection is ACTIVE would need one granted again before its next
-- activation.
-- ALTER TABLE "SsoConnection" DROP COLUMN "domainClaims";
-- DROP TABLE "SsoBreakGlassBinding";

-- AlterTable
ALTER TABLE "SsoConnection" ADD COLUMN     "domainClaims" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
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

-- CreateIndex
CREATE INDEX "SsoBreakGlassBinding_organizationId_expiresAt_idx" ON "SsoBreakGlassBinding"("organizationId", "expiresAt");

-- CreateIndex
CREATE INDEX "SsoBreakGlassBinding_userId_idx" ON "SsoBreakGlassBinding"("userId");
