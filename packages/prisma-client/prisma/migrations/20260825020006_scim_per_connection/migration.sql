-- D08 — directory sync per connection (specs/identity/scim-connection-sync.feature).
--
-- Three things, all additive and all dark behind SCIM_V2_GRANTS:
--
--   1. ScimToken.connectionId — the token's entire write authority. Nullable,
--      because every token that exists today was minted when "which
--      organization" was the whole answer; the backfill below points each at
--      its organization's FIRST connection where there is one, and a token
--      whose organization has no connection keeps exactly the authority it
--      was sold with. Minting a new token without a connection is refused at
--      the service, not here.
--
--   2. ScimExternalId — who the directory means, per connection. The pair
--      (connectionId, externalId) is the key and externalId alone never is:
--      an address is not identity, and the same person carries different
--      identifiers on two different connections.
--
--   3. ScimSyncState — the scim-sync pipeline's projection. Fold-written,
--      never deleted (REVOKED is a tombstone), rebuilt whole-row by a replay.
--      A dead letter that vanished when a connection was torn down would be a
--      removal nobody could check afterwards, which is the one thing this
--      table exists to prevent.
--
-- Plus Group.scimConnectionId, so two connections in one organization can
-- each carry their own "engineering" without one overwriting the other.
--
-- To roll back, uncomment and run manually. Dropping ScimSyncState loses only
-- fold-written projection state, which replay rebuilds from the event log;
-- dropping the other two loses the connection scoping and returns SCIM to its
-- organization-wide authority.
-- ALTER TABLE "ScimToken" DROP COLUMN "connectionId";
-- ALTER TABLE "Group" DROP COLUMN "scimConnectionId";
-- DROP TABLE "ScimExternalId";
-- DROP TABLE "ScimSyncState";

-- AlterTable
ALTER TABLE "ScimToken" ADD COLUMN "connectionId" TEXT;

-- CreateIndex
CREATE INDEX "ScimToken_connectionId_idx" ON "ScimToken"("connectionId");

-- Backfill: each existing token takes its organization's FIRST connection.
-- "First" is oldest-by-createdAt with the id as the tie-break, so the choice
-- is deterministic and a re-run picks the same one. A token whose
-- organization has no connection is left null on purpose — inventing one
-- would be inventing write authority.
UPDATE "ScimToken" AS t
SET "connectionId" = c."id"
FROM (
    SELECT DISTINCT ON ("organizationId") "organizationId", "id"
    FROM "SsoConnection"
    ORDER BY "organizationId", "createdAt" ASC, "id" ASC
) AS c
WHERE t."organizationId" = c."organizationId"
  AND t."connectionId" IS NULL;

-- AlterTable
ALTER TABLE "Group" ADD COLUMN "scimConnectionId" TEXT;

-- CreateIndex
CREATE INDEX "Group_scimConnectionId_idx" ON "Group"("scimConnectionId");

-- CreateIndex
-- Postgres treats NULLs as distinct, so this constrains only the groups that
-- carry a connection. The organization-scoped uniqueness already on the table
-- stays as the safety net for the ones that do not.
CREATE UNIQUE INDEX "Group_scimConnectionId_externalId_key" ON "Group"("scimConnectionId", "externalId");

-- CreateTable
CREATE TABLE "ScimExternalId" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScimExternalId_connectionId_externalId_key" ON "ScimExternalId"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "ScimExternalId_userId_idx" ON "ScimExternalId"("userId");

-- CreateIndex
CREATE INDEX "ScimExternalId_connectionId_idx" ON "ScimExternalId"("connectionId");

-- AddForeignKey
ALTER TABLE "ScimExternalId" ADD CONSTRAINT "ScimExternalId_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ScimSyncState" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lastPushedAt" TIMESTAMP(3),
    "lastFailure" JSONB,
    "deadLetters" JSONB NOT NULL DEFAULT '[]',
    "revokedCause" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "projectionVersion" TEXT NOT NULL,
    -- Event-derived, not database-managed: a default or an ON UPDATE would
    -- make a replayed row differ from the row it rebuilds.
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScimSyncState_organizationId_idx" ON "ScimSyncState"("organizationId");

-- CreateIndex
CREATE INDEX "ScimSyncState_state_idx" ON "ScimSyncState"("state");

-- CreateIndex
CREATE INDEX "ScimSyncState_connectionId_idx" ON "ScimSyncState"("connectionId");
