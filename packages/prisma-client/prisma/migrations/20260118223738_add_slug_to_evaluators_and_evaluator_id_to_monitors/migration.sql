/*
  Warnings:

  - A unique constraint covering the columns `[projectId,slug]` on the table `Evaluator` will be added. If there are existing duplicate values, this will fail.
  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/

-- AlterTable
ALTER TABLE "Evaluator" ADD COLUMN     "slug" TEXT;

-- Populate slug for existing evaluators with format: slugified-name-XXXXX
UPDATE "Evaluator"
SET "slug" = CONCAT(
  TRIM(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')),
  '-',
  substr(md5(random()::text || "id"), 1, 5)
)
WHERE "slug" IS NULL;

-- AlterTable
ALTER TABLE "Monitor" ADD COLUMN     "evaluatorId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Evaluator_projectId_slug_key" ON "Evaluator"("projectId", "slug");

-- CreateIndex
CREATE INDEX "Monitor_evaluatorId_idx" ON "Monitor"("evaluatorId");
