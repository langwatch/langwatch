-- A favourite may now point at a From LangWatch template instead of a board.
-- Additive and standalone: no foreign key (per the database rule). A board
-- star keeps its dashboardId; a template star has a null one and a templateId.
ALTER TABLE "DashboardFavourite" ALTER COLUMN "dashboardId" DROP NOT NULL;

ALTER TABLE "DashboardFavourite" ADD COLUMN IF NOT EXISTS "templateId" TEXT;

-- The table is made one migration earlier in this same release, so it is empty when this
-- builds and the build holds its lock for no time. An install that already holds favourites
-- can build it ahead, outside Prisma's transaction, and this statement is then a no-op:
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "DashboardFavourite_userId_projectId_templateId_key"
--     ON "DashboardFavourite"("userId", "projectId", "templateId");
CREATE UNIQUE INDEX IF NOT EXISTS "DashboardFavourite_userId_projectId_templateId_key" ON "DashboardFavourite"("userId", "projectId", "templateId");
