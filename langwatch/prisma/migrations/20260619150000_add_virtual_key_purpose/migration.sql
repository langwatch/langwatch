-- VirtualKeyPurpose: USER = explicitly created via the gateway UI/API;
-- LANGY = auto-provisioned by the Langy in-product assistant. Replaces the
-- legacy heuristic `name == "Langy" AND principalUserId IS NULL` used by the
-- gateway/virtual-keys UI to badge + lock-down the managed row.
CREATE TYPE "VirtualKeyPurpose" AS ENUM ('USER', 'LANGY');

ALTER TABLE "VirtualKey"
  ADD COLUMN "purpose" "VirtualKeyPurpose" NOT NULL DEFAULT 'USER';

-- Backfill: every existing row that the legacy heuristic identifies as the
-- managed Langy VK is migrated to purpose = 'LANGY' so the new UI badge and
-- the LangyCredentialService lookup keep matching the same rows after deploy.
UPDATE "VirtualKey"
  SET "purpose" = 'LANGY'
  WHERE "name" = 'Langy' AND "principalUserId" IS NULL;

-- Lookup index used by LangyCredentialService.getModelsAllowed (filters by
-- organizationId + purpose to find the LANGY VK for a project's chats).
CREATE INDEX "VirtualKey_organizationId_purpose_idx"
  ON "VirtualKey"("organizationId", "purpose");
