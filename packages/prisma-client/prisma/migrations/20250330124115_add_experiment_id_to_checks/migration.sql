/*
  Warnings:

  - A unique constraint covering the columns `[experimentId]` on the table `Check` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Check" ADD COLUMN     "experimentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Check_experimentId_key" ON "Check"("experimentId");
