-- Webhook endpoints gain a destination kind: HTTPS as before, or an Amazon
-- SQS queue.
--
-- Dropping NOT NULL on "url" is a catalog-only change in Postgres: instant,
-- no table rewrite, and every existing row keeps the URL it has. Existing
-- rows also take the 'http' default, so the CHECK below is satisfied by the
-- whole table the moment it is added.

-- CreateEnum
CREATE TYPE "WebhookDestinationKind" AS ENUM ('http', 'sqs');

-- AlterTable
ALTER TABLE "WebhookEndpoint"
  ADD COLUMN "destinationKind" "WebhookDestinationKind" NOT NULL DEFAULT 'http',
  ADD COLUMN "sqsQueueUrl" TEXT,
  ADD COLUMN "sqsRoleArn" TEXT,
  ADD COLUMN "sqsExternalId" TEXT,
  ADD COLUMN "sqsAccessKeyId" TEXT,
  ADD COLUMN "sqsSecretAccessKeyEncrypted" TEXT,
  ALTER COLUMN "url" DROP NOT NULL;

-- The per-kind shape, which Prisma has no way to express: each kind carries
-- exactly the fields it needs and none of the other kind's.
--
-- The static credential pair is all-or-nothing on purpose. A half-filled pair
-- reaches the AWS SDK as `{accessKeyId: "...", secretAccessKey: ""}`, which it
-- reads as a real answer and stops looking with, so a queue endpoint that
-- meant to use the deployment's own role would fail authentication instead.
--
-- ELSE false rather than a permissive fallthrough: a third destination kind
-- must update this constraint, and failing loudly on the first insert is how
-- that gets noticed.
ALTER TABLE "WebhookEndpoint"
  ADD CONSTRAINT "WebhookEndpoint_destination_shape_check" CHECK (
    CASE "destinationKind"
      WHEN 'http' THEN
        "url" IS NOT NULL
        AND "sqsQueueUrl" IS NULL
        AND "sqsRoleArn" IS NULL
        AND "sqsExternalId" IS NULL
        AND "sqsAccessKeyId" IS NULL
        AND "sqsSecretAccessKeyEncrypted" IS NULL
      WHEN 'sqs' THEN
        "url" IS NULL
        AND "sqsQueueUrl" IS NOT NULL
        AND ("sqsAccessKeyId" IS NULL) = ("sqsSecretAccessKeyEncrypted" IS NULL)
        AND ("sqsExternalId" IS NULL OR "sqsRoleArn" IS NOT NULL)
      ELSE false
    END
  );
