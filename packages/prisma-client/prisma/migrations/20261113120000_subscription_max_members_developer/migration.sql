-- IRREVERSIBLE: adds a nullable column to "Subscription".
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- The Developer seat cap a subscription pays for (specs/members/developer-seat.feature, ADR-171 v7).
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "maxMembersDeveloper" INTEGER;
