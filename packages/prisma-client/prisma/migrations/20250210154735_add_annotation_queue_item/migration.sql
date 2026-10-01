/*
  Warnings:

  - A unique constraint covering the columns `[projectId,slug]` on the table `AnnotationQueue` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `slug` to the `AnnotationQueue` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AnnotationQueue" ADD COLUMN     "slug" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "AnnotationQueueItem" (
    "id" TEXT NOT NULL,
    "annotationQueueId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "traceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "AnnotationQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnnotationQueueItem_annotationQueueId_idx" ON "AnnotationQueueItem"("annotationQueueId");

-- CreateIndex
CREATE INDEX "AnnotationQueueItem_userId_idx" ON "AnnotationQueueItem"("userId");

-- CreateIndex
CREATE INDEX "AnnotationQueueItem_projectId_idx" ON "AnnotationQueueItem"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationQueueItem_traceId_userId_projectId_key" ON "AnnotationQueueItem"("traceId", "userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationQueueItem_traceId_annotationQueueId_projectId_key" ON "AnnotationQueueItem"("traceId", "annotationQueueId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationQueue_projectId_slug_key" ON "AnnotationQueue"("projectId", "slug");
