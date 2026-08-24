-- IRREVERSIBLE: this validates a constraint the previous migration added. The
-- only undo is dropping that constraint, which the previous migration's own
-- rollback block already covers. To roll back, uncomment and run manually:
--
-- ALTER TABLE "WebhookEndpoint"
--   DROP CONSTRAINT "WebhookEndpoint_destination_shape_check";

-- The validating scan for the constraint the previous migration recorded as
-- NOT VALID. It belongs in a transaction of its own: `prisma migrate deploy`
-- runs one migration file in one transaction, and inside the transaction that
-- added the constraint this scan would run under the ACCESS EXCLUSIVE lock
-- that ADD CONSTRAINT took, blocking every read and write on the endpoint
-- table for its duration. Here it takes SHARE UPDATE EXCLUSIVE instead, which
-- readers and writers pass through.
ALTER TABLE "WebhookEndpoint"
  VALIDATE CONSTRAINT "WebhookEndpoint_destination_shape_check";
