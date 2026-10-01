-- Customer-owned identity and bookkeeping on the two governed gateway
-- resources: the id the caller's own system knows the row by, and a free-form
-- map this platform only ever echoes back.
--
-- `externalId` is nullable rather than defaulted to '': Postgres treats NULLs
-- as distinct within a unique index, so any number of rows may carry no
-- external id while the ones that do carry it stay unique per organization.

ALTER TABLE "VirtualKey" ADD COLUMN "externalId" TEXT;
ALTER TABLE "VirtualKey" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "GatewayBudget" ADD COLUMN "externalId" TEXT;
ALTER TABLE "GatewayBudget" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX "VirtualKey_organizationId_externalId_key" ON "VirtualKey"("organizationId", "externalId");
CREATE UNIQUE INDEX "GatewayBudget_organizationId_externalId_key" ON "GatewayBudget"("organizationId", "externalId");
