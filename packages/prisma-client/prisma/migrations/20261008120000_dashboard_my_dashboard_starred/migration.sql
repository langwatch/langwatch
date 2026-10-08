-- A member's My dashboard starts in their stars. New ones are starred when made; this stars each
-- existing one its maker has not starred. Favourites have never shipped, so no member has had a
-- chance to unstar one; an unstar after this deletes the row and stays.
INSERT INTO "DashboardFavourite" ("id", "userId", "dashboardId", "projectId", "position", "createdAt")
SELECT
  gen_random_uuid()::text,
  d."createdById",
  d."id",
  d."projectId",
  COALESCE(
    (
      SELECT max(f."position") + 1
      FROM "DashboardFavourite" AS f
      WHERE f."userId" = d."createdById"
        AND f."projectId" = d."projectId"
    ),
    0
  ),
  CURRENT_TIMESTAMP
FROM "Dashboard" AS d
WHERE d."name" = 'My dashboard'
  AND d."createdById" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "DashboardFavourite" AS f
    WHERE f."userId" = d."createdById"
      AND f."dashboardId" = d."id"
  );
