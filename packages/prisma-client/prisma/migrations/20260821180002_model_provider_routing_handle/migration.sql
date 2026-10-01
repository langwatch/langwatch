-- Routing handle: the operator-chosen slug that addresses ONE ModelProvider
-- instance in a gateway model string ("eu/claude-sonnet-5"). Nullable, because
-- a provider without one keeps being reached by its family prefix.
ALTER TABLE "ModelProvider" ADD COLUMN "routingHandle" TEXT;

-- Unique inside the organization. Postgres treats NULLs as distinct in a
-- unique index, so every provider that sets no handle still fits, which is
-- most of them. Declared in schema.prisma as well, so the next `migrate dev`
-- reads it as the schema rather than as drift to drop.
CREATE UNIQUE INDEX "ModelProvider_organizationId_routingHandle_key"
  ON "ModelProvider" ("organizationId", "routingHandle");

-- To roll back, uncomment and run manually. The column holds the handles
-- operators chose, and dropping it discards them: every caller sending
-- "eu/claude-sonnet-5" then falls back to the family prefix, which picks the
-- instance by chain order. Export the handles first if they must survive.
--
-- DROP INDEX "ModelProvider_organizationId_routingHandle_key";
-- ALTER TABLE "ModelProvider" DROP COLUMN "routingHandle";
