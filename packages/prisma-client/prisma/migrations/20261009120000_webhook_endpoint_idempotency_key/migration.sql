-- A create key for webhook endpoints, owned by webhook. Governance's anomaly destination migration
-- passes one per rule destination, so a run stopped between creating an endpoint and writing it onto
-- the rule answers the same endpoint when it runs again; the unique index decides a concurrent
-- create (Alex, 2026-10-09, D2). Null for every other endpoint, and Postgres admits many nulls
-- under a unique index, so no existing row conflicts.
--
-- Expand only: a nullable column with no default, so no rewrite and no backfill. No foreign key.
--
-- Spec: modules/webhook/specs/webhooks.feature (the create key scenarios)
--
-- ops pre-build: the column is new and every row is null, so the build is one quick scan, but an
-- install with real traffic may build it ahead, outside Prisma's transaction:
--   ALTER TABLE "WebhookEndpoint" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "WebhookEndpoint_organizationId_idempotencyKey_key"
--     ON "WebhookEndpoint" ("organizationId", "idempotencyKey");
-- A failed concurrent build leaves an invalid index that IF NOT EXISTS then skips: check
-- pg_index.indisvalid and DROP INDEX CONCURRENTLY before retrying.
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP INDEX IF EXISTS "WebhookEndpoint_organizationId_idempotencyKey_key";
--   ALTER TABLE "WebhookEndpoint" DROP COLUMN "idempotencyKey";

ALTER TABLE "WebhookEndpoint" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEndpoint_organizationId_idempotencyKey_key"
  ON "WebhookEndpoint" ("organizationId", "idempotencyKey");
