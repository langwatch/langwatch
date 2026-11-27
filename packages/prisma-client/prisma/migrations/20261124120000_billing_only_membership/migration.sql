-- IRREVERSIBLE: adds the billingOnly flag to invitations and memberships (ADR-205).
-- A rollback leaves the columns in place; the previous release never names them.
-- A constant DEFAULT is a catalogue-only change, so neither ALTER rewrites its table.
ALTER TABLE "OrganizationInvite" ADD COLUMN IF NOT EXISTS "billingOnly" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OrganizationUser" ADD COLUMN IF NOT EXISTS "billingOnly" BOOLEAN NOT NULL DEFAULT false;
