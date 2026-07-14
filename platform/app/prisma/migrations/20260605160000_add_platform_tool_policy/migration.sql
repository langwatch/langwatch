-- CreateTable
CREATE TABLE "PlatformToolPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "toolSlug" TEXT NOT NULL,
    "allowVk" BOOLEAN NOT NULL DEFAULT true,
    "allowOtelDirect" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformToolPolicy_pkey" PRIMARY KEY ("id")
);

-- At most one policy row per (organizationId, toolSlug). A missing row resolves
-- to the hardcoded defaults, so this table is purely additive: a row exists
-- only when an admin has explicitly toggled a path for that tool.
-- CreateIndex
CREATE UNIQUE INDEX "PlatformToolPolicy_organizationId_toolSlug_key" ON "PlatformToolPolicy"("organizationId", "toolSlug");

-- CreateIndex
CREATE INDEX "PlatformToolPolicy_organizationId_idx" ON "PlatformToolPolicy"("organizationId");
