/*
  Warnings:

  - A unique constraint covering the columns `[traceId]` on the table `AnnotationQueueItem` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "AnnotationQueueItem_traceId_key" ON "AnnotationQueueItem"("traceId");
