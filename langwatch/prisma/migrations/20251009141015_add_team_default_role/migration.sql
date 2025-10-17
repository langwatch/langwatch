-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "defaultCustomRoleId" TEXT;

-- CreateIndex
CREATE INDEX "Team_defaultCustomRoleId_idx" ON "Team"("defaultCustomRoleId");
