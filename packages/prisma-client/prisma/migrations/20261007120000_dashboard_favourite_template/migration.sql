-- A favourite may now point at a From LangWatch template instead of a board.
-- Additive and standalone: no foreign key (per the database rule). A board
-- star keeps its dashboardId; a template star has a null one and a templateId.
ALTER TABLE "DashboardFavourite" ALTER COLUMN "dashboardId" DROP NOT NULL;

ALTER TABLE "DashboardFavourite" ADD COLUMN "templateId" TEXT;

CREATE UNIQUE INDEX "DashboardFavourite_userId_projectId_templateId_key" ON "DashboardFavourite"("userId", "projectId", "templateId");
