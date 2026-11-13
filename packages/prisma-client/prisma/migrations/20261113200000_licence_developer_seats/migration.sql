-- IRREVERSIBLE: adds a nullable column to "IssuedLicense" and to "ActivationCode".
-- A rollback leaves them in place; dropping one is an operator step confirmed in Ops.
-- The Developer seats a registry row and an activation code carry, so a reissue and a
-- redemption keep them (enterprise/modules/licensing/specs/licensing.feature). Null sells none.
ALTER TABLE "IssuedLicense" ADD COLUMN IF NOT EXISTS "maxMembersDeveloper" INTEGER;
ALTER TABLE "ActivationCode" ADD COLUMN IF NOT EXISTS "maxMembersDeveloper" INTEGER;
