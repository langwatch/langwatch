/*
  Warnings:

  - A unique constraint covering the columns `[traceId,userId,projectId]` on the table `AnnotationQueueItem` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[traceId,annotationQueueId,projectId]` on the table `AnnotationQueueItem` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "AnnotationQueueItem_traceId_annotationQueueId_key";

-- DropIndex
DROP INDEX "AnnotationQueueItem_traceId_userId_key";

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationQueueItem_traceId_userId_projectId_key" ON "AnnotationQueueItem"("traceId", "userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnotationQueueItem_traceId_annotationQueueId_projectId_key" ON "AnnotationQueueItem"("traceId", "annotationQueueId", "projectId");
