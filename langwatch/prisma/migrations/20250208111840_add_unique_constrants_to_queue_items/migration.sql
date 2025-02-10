/*
  Warnings:

  - A unique constraint covering the columns `[traceId,userId]` on the table `AnnotationQueueItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[traceId,annotationQueueId]` on the table `AnnotationQueueItem` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "AnnotationQueueItem_traceId_key";

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationQueueItem_traceId_userId_key" ON "AnnotationQueueItem"("traceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationQueueItem_traceId_annotationQueueId_key" ON "AnnotationQueueItem"("traceId", "annotationQueueId");
