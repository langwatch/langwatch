-- IRREVERSIBLE: additive only; drops are an Ops step.
-- ADR-180 section 3: a testing licence is marked by its kind and names the local
-- organization it was issued for. The instance it is bound to reuses "instanceId".
ALTER TABLE "IssuedLicense"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS "testingOrganizationId" TEXT;
