-- AlterTable
ALTER TABLE "WebhookEndpoint" ADD COLUMN "previousSecretEncrypted" TEXT,
ADD COLUMN "previousSecretExpiresAt" TIMESTAMP(3);

-- Down (manual):
--   ALTER TABLE "WebhookEndpoint" DROP COLUMN "previousSecretEncrypted",
--   DROP COLUMN "previousSecretExpiresAt";
