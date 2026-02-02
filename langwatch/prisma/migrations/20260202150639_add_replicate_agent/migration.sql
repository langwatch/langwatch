/*
  Warnings:

  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "copiedFromAgentId" TEXT;

-- CreateIndex
CREATE INDEX "Agent_copiedFromAgentId_idx" ON "Agent"("copiedFromAgentId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_copiedFromAgentId_fkey" FOREIGN KEY ("copiedFromAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
