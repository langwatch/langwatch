/*
  Warnings:

  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/


-- AlterTable
ALTER TABLE "Evaluator" ADD COLUMN     "copiedFromEvaluatorId" TEXT;

-- CreateIndex
CREATE INDEX "Evaluator_copiedFromEvaluatorId_idx" ON "Evaluator"("copiedFromEvaluatorId");
