-- AlterTable
ALTER TABLE "WebhookEndpoint" ADD COLUMN "maxBatchSize" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "maxBatchDelayMs" INTEGER NOT NULL DEFAULT 250,
ADD COLUMN "maxInFlight" INTEGER NOT NULL DEFAULT 4;

-- Down (manual):
--   ALTER TABLE "WebhookEndpoint" DROP COLUMN "maxBatchSize",
--   DROP COLUMN "maxBatchDelayMs",
--   DROP COLUMN "maxInFlight";
