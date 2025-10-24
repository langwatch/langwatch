/*
  Warnings:

  - You are about to drop the `TeamUserCustomRole` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "TeamUser" ADD COLUMN     "assignedRoleId" TEXT;

-- DropTable
DROP TABLE "TeamUserCustomRole";

-- CreateIndex
CREATE INDEX "TeamUser_assignedRoleId_idx" ON "TeamUser"("assignedRoleId");
