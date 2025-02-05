-- CreateTable
CREATE TABLE "AnnotationQueue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnotationQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnotationQueueMembers" (
    "annotationQueueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AnnotationQueueMembers_pkey" PRIMARY KEY ("annotationQueueId","userId")
);

-- CreateTable
CREATE TABLE "AnnotationQueueScores" (
    "annotationQueueId" TEXT NOT NULL,
    "annotationScoreId" TEXT NOT NULL,

    CONSTRAINT "AnnotationQueueScores_pkey" PRIMARY KEY ("annotationQueueId","annotationScoreId")
);

-- CreateIndex
CREATE INDEX "AnnotationQueueMembers_annotationQueueId_idx" ON "AnnotationQueueMembers"("annotationQueueId");

-- CreateIndex
CREATE INDEX "AnnotationQueueMembers_userId_idx" ON "AnnotationQueueMembers"("userId");

-- CreateIndex
CREATE INDEX "AnnotationQueueScores_annotationQueueId_idx" ON "AnnotationQueueScores"("annotationQueueId");

-- CreateIndex
CREATE INDEX "AnnotationQueueScores_annotationScoreId_idx" ON "AnnotationQueueScores"("annotationScoreId");
