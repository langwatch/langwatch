-- How a webhook endpoint formats and signs its deliveries, owned by webhook. Null keeps the batch
-- envelope and the `t=,v1=` signature every endpoint has today; `legacy_sha256` marks an endpoint
-- migrated from a governance anomaly destination, which receives one raw alert per POST signed
-- `sha256=` as main's anomaly dispatcher sent it (request delivery Q2 and Q3, 2026-10-05).
--
-- Expand only: a nullable column with no default, so no rewrite and no backfill. No foreign key.
--
-- Spec: modules/webhook/specs/webhook-egress.feature (the legacy alert format rule)
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   ALTER TABLE "WebhookEndpoint" DROP COLUMN "signatureScheme";

ALTER TABLE "WebhookEndpoint" ADD COLUMN IF NOT EXISTS "signatureScheme" TEXT;
