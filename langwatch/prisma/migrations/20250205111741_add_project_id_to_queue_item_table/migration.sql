/*
  Warnings:

  - Added the required column `projectId` to the `AnnotationQueueItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AnnotationQueueItem" ADD COLUMN     "projectId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "AnnotationQueueItem_projectId_idx" ON "AnnotationQueueItem"("projectId");
