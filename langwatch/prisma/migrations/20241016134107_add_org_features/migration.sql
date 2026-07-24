-- CreateTable
CREATE TABLE "OrganizationFeature" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationFeature_feature_idx" ON "OrganizationFeature"("feature");

-- CreateIndex
CREATE INDEX "OrganizationFeature_organizationId_idx" ON "OrganizationFeature"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationFeature_feature_organizationId_key" ON "OrganizationFeature"("feature", "organizationId");
