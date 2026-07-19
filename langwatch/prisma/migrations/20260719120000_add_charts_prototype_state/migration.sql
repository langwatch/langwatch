-- PROTOTYPE (#5670 S1) -- isolated, minimal server-side persistence for the
-- charts-proto query-builder dashboard. Deliberately separate from the real
-- Dashboard/CustomGraph tables (see model doc-comment in schema.prisma) so
-- this prototype's data can never be rendered through the real
-- /analytics/reports page's CustomGraph component.

-- CreateTable
CREATE TABLE "ChartsPrototypeState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Untitled dashboard',
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartsPrototypeState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChartsPrototypeState_projectId_key" ON "ChartsPrototypeState"("projectId");

-- AddForeignKey
ALTER TABLE "ChartsPrototypeState" ADD CONSTRAINT "ChartsPrototypeState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- To roll back, uncomment and run manually:
-- DROP TABLE "ChartsPrototypeState";
