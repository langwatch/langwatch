-- ADR-094 foundations: who does a provider login belong to, and which bots
-- have we seen. Three additive pieces, no runtime behavior change — nothing
-- reads these until the write-path and read-path batches land.
--
-- 1. ProviderIdentityLink: add-only history of "this provider login belongs
--    to this person from this moment, on this connection". Corrections are
--    new rows that win the (effectiveFrom DESC, seq DESC) ordering; `seq` is
--    a database-assigned tie-break for rows sharing a timestamp (precedent:
--    GatewayChangeEvent.revision). Reporting only — never read by any
--    permission check.
-- 2. DiscoveredAgent: inventory of bots/agents seen in providers, keyed by
--    (organization, connection, provider label combination).
-- 3. OrganizationUser gains the directory anchor Group already has
--    (externalId + scimSource): the IdP's id for the member, so SCIM events
--    can name a person without guessing by email.
--
-- The datasource runs relationMode="prisma": userId, actorUserId and
-- providerConnectionId are plain columns with no SQL foreign key; the service
-- validates the connection belongs to the organization before insert.
-- The unique index on ("organizationId", "externalId") admits many NULL
-- externalId rows per org (Postgres treats NULLs as distinct), so existing
-- memberships are untouched.

-- CreateTable
CREATE TABLE "ProviderIdentityLink" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "externalKind" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "userId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "actorUserId" TEXT,
    "erasedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderIdentityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredAgent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerConnectionId" TEXT NOT NULL,
    "providerAgentKey" TEXT NOT NULL,
    "snapshot" JSONB,

    CONSTRAINT "DiscoveredAgent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "OrganizationUser" ADD COLUMN "externalId" TEXT;
ALTER TABLE "OrganizationUser" ADD COLUMN "scimSource" TEXT;

-- CreateIndex
CREATE INDEX "ProviderIdentityLink_organizationId_provider_providerConnec_idx" ON "ProviderIdentityLink"("organizationId", "provider", "providerConnectionId", "externalKind", "externalId", "effectiveFrom" DESC);

-- CreateIndex
CREATE INDEX "ProviderIdentityLink_organizationId_userId_idx" ON "ProviderIdentityLink"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredAgent_organizationId_providerConnectionId_provide_key" ON "DiscoveredAgent"("organizationId", "providerConnectionId", "providerAgentKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUser_organizationId_externalId_key" ON "OrganizationUser"("organizationId", "externalId");

-- Down (manual): reverses this migration; run only to roll back.
--   DROP INDEX "OrganizationUser_organizationId_externalId_key";
--   ALTER TABLE "OrganizationUser" DROP COLUMN "scimSource";
--   ALTER TABLE "OrganizationUser" DROP COLUMN "externalId";
--   DROP TABLE "DiscoveredAgent";
--   DROP TABLE "ProviderIdentityLink";
