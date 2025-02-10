/*
  Warnings:

  - A unique constraint covering the columns `[projectId,slug]` on the table `AnnotationQueue` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "AnnotationQueue_projectId_slug_key" ON "AnnotationQueue"("projectId", "slug");
