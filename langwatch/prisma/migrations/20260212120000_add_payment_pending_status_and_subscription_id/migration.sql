-- AlterEnum
ALTER TYPE "INVITE_STATUS" ADD VALUE 'PAYMENT_PENDING';

-- AlterTable
ALTER TABLE "OrganizationInvite" ADD COLUMN     "subscriptionId" TEXT;
