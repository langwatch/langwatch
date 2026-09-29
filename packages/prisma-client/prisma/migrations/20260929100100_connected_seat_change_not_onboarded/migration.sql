-- IRREVERSIBLE: PostgreSQL cannot remove a value from an enum type. The value
-- is inert on a build that never writes it.
--
-- Expand only. A seat change for a customer with no billing account is now a
-- stored decision (`not_onboarded`), so a later onboarding never bills it:
-- such a row has no account and no currency, and names its organization.
-- The previous image writes every column it knew, so its rows stay valid.

-- AlterEnum
ALTER TYPE "ConnectedSeatChangeState" ADD VALUE IF NOT EXISTS 'not_onboarded';

-- AlterTable
ALTER TABLE "ConnectedSeatChange" ALTER COLUMN "accountId" DROP NOT NULL;
ALTER TABLE "ConnectedSeatChange" ALTER COLUMN "currency" DROP NOT NULL;
ALTER TABLE "ConnectedSeatChange" ADD COLUMN "organizationId" TEXT;

-- Backfill: the rows written before this column existed name their account.
UPDATE "ConnectedSeatChange" AS change
SET "organizationId" = account."organizationId"
FROM "ConnectedBillingAccount" AS account
WHERE account."id" = change."accountId" AND change."organizationId" IS NULL;

-- CreateIndex
CREATE INDEX "ConnectedSeatChange_organizationId_idx" ON "ConnectedSeatChange"("organizationId");
