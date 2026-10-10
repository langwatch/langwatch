-- IRREVERSIBLE: there is no down step, because one would discard live
-- endpoint configuration. Restoring NOT NULL on "url" also scans the table and
-- FAILS while any sqs endpoint exists, so a rollback after the feature has
-- been used has to delete or convert those rows first, and deleting them
-- destroys the queue configuration and the encrypted secret access key with
-- them. To roll back, uncomment and run manually:
--
-- ALTER TABLE "WebhookEndpoint"
--   DROP CONSTRAINT "WebhookEndpoint_destination_shape_check";
-- DELETE FROM "WebhookEndpoint" WHERE "destinationKind" = 'sqs';
-- ALTER TABLE "WebhookEndpoint"
--   DROP COLUMN "sqsSecretAccessKeyEncrypted",
--   DROP COLUMN "sqsAccessKeyId",
--   DROP COLUMN "sqsExternalId",
--   DROP COLUMN "sqsRoleArn",
--   DROP COLUMN "sqsQueueUrl",
--   DROP COLUMN "destinationKind",
--   ALTER COLUMN "url" SET NOT NULL;
-- DROP TYPE "WebhookDestinationKind";

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
--
-- NOT VALID, and validated by the NEXT migration rather than this one. A plain
-- ADD CONSTRAINT holds an ACCESS EXCLUSIVE lock for the whole table scan,
-- which blocks every read and write on the endpoint table while it runs. NOT
-- VALID takes that lock only long enough to record the constraint. The
-- validating scan then runs under SHARE UPDATE EXCLUSIVE, which readers and
-- writers pass through, but only if it is in a transaction of its own:
-- `prisma migrate deploy` runs one migration file in one transaction, so
-- validating here would sit under the ACCESS EXCLUSIVE lock this statement
-- took and give back nothing. New rows are checked from the moment the
-- constraint exists either way.
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
  ) NOT VALID;
