-- CreateTable
CREATE TABLE "Dashboard" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dashboard_projectId_idx" ON "Dashboard"("projectId");

-- CreateIndex
CREATE INDEX "Dashboard_projectId_order_idx" ON "Dashboard"("projectId", "order");

-- AlterTable
ALTER TABLE "CustomGraph" ADD COLUMN "colSpan" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "gridColumn" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "gridRow" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "dashboardId" TEXT,
ADD COLUMN "rowSpan" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "CustomGraph_dashboardId_idx" ON "CustomGraph"("dashboardId");

-- Migration: Create default "Reports" page for each project with existing graphs
INSERT INTO "Dashboard" ("id", "projectId", "name", "order", "createdAt", "updatedAt")
SELECT
    'rp_' || "projectId",
    "projectId",
    'Reports',
    0,
    NOW(),
    NOW()
FROM "CustomGraph"
GROUP BY "projectId";

-- Update existing CustomGraphs to link to their default page with sequential positions
WITH numbered_graphs AS (
    SELECT
        "id",
        "projectId",
        ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "createdAt") - 1 as row_num
    FROM "CustomGraph"
)
UPDATE "CustomGraph" cg
SET
    "dashboardId" = 'rp_' || cg."projectId",
    "gridRow" = ng.row_num
FROM numbered_graphs ng
WHERE cg."id" = ng."id";
