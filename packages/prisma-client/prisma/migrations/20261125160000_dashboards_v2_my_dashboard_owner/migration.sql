-- The member whose own My dashboard a board is; filled for older rows by a background step.
ALTER TABLE "DashboardsV2" ADD COLUMN IF NOT EXISTS "myDashboardOfUserId" TEXT;
