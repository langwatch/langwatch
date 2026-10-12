ALTER TABLE "CostCenter" RENAME TO "Department";
ALTER INDEX "CostCenter_organizationId_idx" RENAME TO "Department_organizationId_idx";
ALTER INDEX "CostCenter_organizationId_name_active_key" RENAME TO "Department_organizationId_name_active_key";
ALTER TABLE "OrganizationUser" RENAME COLUMN "costCenterId" TO "departmentId";
ALTER INDEX "OrganizationUser_costCenterId_idx" RENAME TO "OrganizationUser_departmentId_idx";
ALTER TABLE "Team" RENAME COLUMN "costCenterId" TO "departmentId";
ALTER INDEX "Team_costCenterId_idx" RENAME TO "Team_departmentId_idx";
ALTER TABLE "Project" RENAME COLUMN "costCenterId" TO "departmentId";
ALTER INDEX "Project_costCenterId_idx" RENAME TO "Project_departmentId_idx";

-- To roll back, uncomment and run manually:
-- ALTER INDEX "Project_departmentId_idx" RENAME TO "Project_costCenterId_idx";
-- ALTER TABLE "Project" RENAME COLUMN "departmentId" TO "costCenterId";
-- ALTER INDEX "Team_departmentId_idx" RENAME TO "Team_costCenterId_idx";
-- ALTER TABLE "Team" RENAME COLUMN "departmentId" TO "costCenterId";
-- ALTER INDEX "OrganizationUser_departmentId_idx" RENAME TO "OrganizationUser_costCenterId_idx";
-- ALTER TABLE "OrganizationUser" RENAME COLUMN "departmentId" TO "costCenterId";
-- ALTER INDEX "Department_organizationId_name_active_key" RENAME TO "CostCenter_organizationId_name_active_key";
-- ALTER INDEX "Department_organizationId_idx" RENAME TO "CostCenter_organizationId_idx";
-- ALTER TABLE "Department" RENAME TO "CostCenter";
