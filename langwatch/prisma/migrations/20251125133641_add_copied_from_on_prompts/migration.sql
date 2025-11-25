/*
  Warnings:

  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "LlmPromptConfig" ADD COLUMN     "copiedFromPromptId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "metadata" SET NOT NULL;

-- CreateIndex
CREATE INDEX "LlmPromptConfig_copiedFromPromptId_idx" ON "LlmPromptConfig"("copiedFromPromptId");
