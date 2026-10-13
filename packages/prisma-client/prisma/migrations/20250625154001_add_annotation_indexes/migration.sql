-- CreateIndex
CREATE INDEX "Annotation_projectId_traceId_idx" ON "Annotation"("projectId", "traceId");

-- CreateIndex
CREATE INDEX "AnnotationQueue_projectId_idx" ON "AnnotationQueue"("projectId");

-- CreateIndex
CREATE INDEX "AnnotationQueueItem_projectId_doneAt_idx" ON "AnnotationQueueItem"("projectId", "doneAt");

-- CreateIndex
CREATE INDEX "AnnotationQueueItem_projectId_userId_doneAt_idx" ON "AnnotationQueueItem"("projectId", "userId", "doneAt");

-- CreateIndex
CREATE INDEX "AnnotationQueueItem_annotationQueueId_doneAt_idx" ON "AnnotationQueueItem"("annotationQueueId", "doneAt");


