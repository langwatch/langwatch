-- Routing handle: the operator-chosen slug that addresses ONE ModelProvider
-- instance in a gateway model string ("eu/claude-sonnet-5"). Nullable, because
-- a provider without one keeps being reached by its family prefix.
ALTER TABLE "ModelProvider" ADD COLUMN "routingHandle" TEXT;

-- Unique inside the organization, and only over the rows that set one. A plain
-- unique index would let exactly one row per organization leave the handle
-- unset, which is the opposite of the intent: most rows have no handle.
CREATE UNIQUE INDEX "ModelProvider_organizationId_routingHandle_key"
  ON "ModelProvider" ("organizationId", "routingHandle")
  WHERE "routingHandle" IS NOT NULL;
