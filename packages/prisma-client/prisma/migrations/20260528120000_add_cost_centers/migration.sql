-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostCenter_organizationId_idx" ON "CostCenter"("organizationId");

-- AlterTable
ALTER TABLE "OrganizationUser" ADD COLUMN "costCenterId" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN "costCenterId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "costCenterId" TEXT;

-- CreateIndex
CREATE INDEX "OrganizationUser_costCenterId_idx" ON "OrganizationUser"("costCenterId");

-- CreateIndex
CREATE INDEX "Team_costCenterId_idx" ON "Team"("costCenterId");

-- CreateIndex
CREATE INDEX "Project_costCenterId_idx" ON "Project"("costCenterId");
