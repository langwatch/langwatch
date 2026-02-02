/*
  Warnings:

  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "copiedFromAgentId" TEXT;

-- CreateIndex
CREATE INDEX "Agent_copiedFromAgentId_idx" ON "Agent"("copiedFromAgentId");
