/*
  Warnings:

  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "metadata" SET NOT NULL;

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "copiedFromWorkflowId" TEXT;

-- CreateIndex
CREATE INDEX "Workflow_copiedFromWorkflowId_idx" ON "Workflow"("copiedFromWorkflowId");
