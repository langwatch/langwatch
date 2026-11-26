-- Each member's own order of a product sidebar's Dashboards section, per organization.
CREATE TABLE IF NOT EXISTS "DashboardSidebarOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "homeProduct" TEXT NOT NULL,
    "dashboardIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardSidebarOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DashboardSidebarOrder_userId_organizationId_homeProduct_key" ON "DashboardSidebarOrder"("userId", "organizationId", "homeProduct");
