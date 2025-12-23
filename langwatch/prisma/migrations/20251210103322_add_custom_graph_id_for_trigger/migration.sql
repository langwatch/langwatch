/*
  Warnings:

  - A unique constraint covering the columns `[customGraphId]` on the table `Trigger` will be added. If there are existing duplicate values, this will fail.
  - Made the column `metadata` on table `Notification` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "metadata" SET NOT NULL;

-- AlterTable
ALTER TABLE "Trigger" ADD COLUMN     "customGraphId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Trigger_customGraphId_key" ON "Trigger"("customGraphId");
