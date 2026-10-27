-- Fold the automations webhook delivery log into the endpoints one.
--
-- Two tables held the same facts about the same thing. WebhookDelivery logged
-- one row per HTTP attempt for the automations channel; WebhookEndpointDelivery
-- logged one row per HTTP attempt for the endpoints platform. Same columns, same
-- outcome enum, same 30-day retention, written by the same sender -- and two
-- prune implementations behind them, one looping per project because the tenancy
-- guard rejects a global delete, the other a single raw-SQL sweep. An operator
-- asking "did that webhook go out" had to know which product surface configured
-- it before they knew which table to read.
--
-- They become one table with a channel discriminator. The columns that carry
-- tenancy differ per channel and there is no honest way around that: a platform
-- row belongs to an organization and an endpoint, an automations row to a project
-- and a trigger. So both pairs are nullable and `channel` says which pair to
-- read. `attempt` and `eventCount` become nullable for the same reason -- the
-- automations writer records neither, and back-filling a 1 would be a claim its
-- sender never made.
--
-- The existing rows keep their meaning: everything already in
-- WebhookEndpointDelivery is a platform row, which is exactly what the column
-- default says, so no back-fill is needed for them. The automations rows are
-- copied across with channel='automations' before their table is dropped. Ids
-- are nanoid on both sides and were never compared across the two, so the copy
-- cannot collide.
--
-- Retention is why the copy is worth doing at all rather than starting the new
-- table empty: the log is capped at 30 days, so at most 30 days of automations
-- history exists, and it is the drill-down behind a trigger's "recent fires" in
-- the drawer. Dropping it would blank that panel for every existing trigger.
--
-- One bounded gap is accepted rather than solved: between this migration running
-- and the last old-code pod draining, those pods keep writing into
-- WebhookDelivery, which no longer exists, and their delivery-log write fails.
-- That write is already best-effort on the dispatch path (it is wrapped so a
-- logging failure never fails a delivery), so the cost of the straddle is a
-- handful of unlogged attempts, not a dropped webhook.

-- CreateEnum
CREATE TYPE "WebhookDeliveryChannel" AS ENUM ('platform', 'automations');

-- AlterTable
ALTER TABLE "WebhookEndpointDelivery"
    ADD COLUMN "channel" "WebhookDeliveryChannel" NOT NULL DEFAULT 'platform',
    ADD COLUMN "projectId" TEXT,
    ADD COLUMN "triggerId" TEXT,
    ALTER COLUMN "organizationId" DROP NOT NULL,
    ALTER COLUMN "endpointId" DROP NOT NULL,
    ALTER COLUMN "attempt" DROP NOT NULL,
    ALTER COLUMN "eventCount" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "WebhookEndpointDelivery_projectId_triggerId_firedAt_idx" ON "WebhookEndpointDelivery"("projectId", "triggerId", "firedAt");

-- CreateIndex
CREATE INDEX "WebhookEndpointDelivery_projectId_triggerId_dispatchId_idx" ON "WebhookEndpointDelivery"("projectId", "triggerId", "dispatchId");

-- AddForeignKey
ALTER TABLE "WebhookEndpointDelivery" ADD CONSTRAINT "WebhookEndpointDelivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpointDelivery" ADD CONSTRAINT "WebhookEndpointDelivery_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "Trigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the retained automations history across.
INSERT INTO "WebhookEndpointDelivery" (
    "id", "channel", "organizationId", "endpointId", "projectId", "triggerId",
    "dispatchId", "attempt", "eventCount", "responseStatus", "latencyMs",
    "error", "response", "outcome", "firedAt", "createdAt"
)
SELECT
    "id", 'automations', NULL, NULL, "projectId", "triggerId",
    "dispatchId", NULL, NULL, "responseStatus", "latencyMs",
    "error", "response", "outcome", "firedAt", "createdAt"
FROM "WebhookDelivery";

-- DropTable
DROP TABLE "WebhookDelivery";

-- To roll back, uncomment and run manually. Note that this recreates the table
-- empty: the automations rows now live in WebhookEndpointDelivery and a rollback
-- would have to copy back the channel='automations' ones before dropping them.
-- ALTER TABLE "WebhookEndpointDelivery" DROP CONSTRAINT "WebhookEndpointDelivery_triggerId_fkey";
-- ALTER TABLE "WebhookEndpointDelivery" DROP CONSTRAINT "WebhookEndpointDelivery_projectId_fkey";
-- ALTER TABLE "WebhookEndpointDelivery" DROP COLUMN "channel", DROP COLUMN "projectId", DROP COLUMN "triggerId";
-- DROP TYPE "WebhookDeliveryChannel";
