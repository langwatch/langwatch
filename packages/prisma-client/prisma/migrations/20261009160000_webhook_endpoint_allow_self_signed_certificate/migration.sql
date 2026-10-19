-- A per-endpoint opt-in, owned by webhook: a self-hosted endpoint may accept its receiver's
-- self-signed TLS certificate. Off for every row, so every existing endpoint verifies certificates
-- from this release (Alex, 2026-10-09, ruling F).
--
-- Expand only: a constant default, so no rewrite and no backfill. No foreign key.
--
-- Spec: modules/webhook/specs/webhook-egress.feature (the certificate scenarios)
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   ALTER TABLE "WebhookEndpoint" DROP COLUMN "allowSelfSignedCertificate";

ALTER TABLE "WebhookEndpoint" ADD COLUMN IF NOT EXISTS "allowSelfSignedCertificate" BOOLEAN NOT NULL DEFAULT false;
