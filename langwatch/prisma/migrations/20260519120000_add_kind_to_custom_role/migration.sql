-- Distinguish user-created custom roles from system-generated ones.
-- "custom" = user-created (default), "system_api_key" = generated for API keys.
ALTER TABLE "CustomRole" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'custom';

-- Backfill: rows whose name starts with "apikey:" are generated backing roles.
-- The "apikey:" prefix is reserved and enforced at the service layer, so this
-- discriminator has zero false positives on existing data.
UPDATE "CustomRole" SET "kind" = 'system_api_key' WHERE "name" LIKE 'apikey:%';
