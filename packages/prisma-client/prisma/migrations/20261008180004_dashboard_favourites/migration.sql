-- A member's starred dashboards, in their own order within a project.
-- Additive and standalone: no foreign key (per the database rule), so the
-- dashboard service removes a board's favourites when it deletes the board.
CREATE TABLE "DashboardFavourite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardFavourite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DashboardFavourite_userId_dashboardId_key" ON "DashboardFavourite"("userId", "dashboardId");

CREATE INDEX "DashboardFavourite_userId_projectId_position_idx" ON "DashboardFavourite"("userId", "projectId", "position");

CREATE INDEX "DashboardFavourite_dashboardId_idx" ON "DashboardFavourite"("dashboardId");
