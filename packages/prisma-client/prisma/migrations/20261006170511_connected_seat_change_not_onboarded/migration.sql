-- IRREVERSIBLE: PostgreSQL cannot remove a value from an enum type. The value
-- is inert on a build that never writes it.
--
-- Expand only. A seat change for a customer with no billing account is now a
-- stored decision (`not_onboarded`), so a later onboarding never bills it:
-- such a row has no account and no currency, and names its organization.
-- The previous image writes every column it knew, so its rows stay valid.
-- One ALTER per table per migration: currency and organizationId follow in
-- 20261006170521 and 20261006170522.

-- AlterEnum
ALTER TYPE "ConnectedSeatChangeState" ADD VALUE IF NOT EXISTS 'not_onboarded';

-- AlterTable
ALTER TABLE "ConnectedSeatChange" ALTER COLUMN "accountId" DROP NOT NULL;
