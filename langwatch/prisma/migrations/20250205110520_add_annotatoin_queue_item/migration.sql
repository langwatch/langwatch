-- CreateTable
CREATE TABLE "AnnotationQueueItem" (
    "id" TEXT NOT NULL,
    "annotationQueueId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traceId" TEXT NOT NULL,

    CONSTRAINT "AnnotationQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnnotationQueueItem_annotationQueueId_idx" ON "AnnotationQueueItem"("annotationQueueId");

-- CreateIndex
CREATE INDEX "AnnotationQueueItem_userId_idx" ON "AnnotationQueueItem"("userId");
