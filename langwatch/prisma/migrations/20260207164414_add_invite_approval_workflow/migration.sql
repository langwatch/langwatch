-- AlterEnum
ALTER TYPE "INVITE_STATUS" ADD VALUE 'WAITING_APPROVAL';

-- AlterTable
ALTER TABLE "OrganizationInvite" ADD COLUMN     "requestedBy" TEXT,
ALTER COLUMN "expiration" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "OrganizationInvite_requestedBy_idx" ON "OrganizationInvite"("requestedBy");
