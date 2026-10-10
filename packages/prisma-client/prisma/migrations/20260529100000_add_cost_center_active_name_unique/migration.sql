-- At most one ACTIVE cost center per (organizationId, name). Archived centers
-- do not block reusing the name, so the index is scoped to archivedAt IS NULL.
-- This backs CostCenterService.resolveByNameOrCreate against concurrent SCIM
-- provisioning of the same new cost-center name: the TOCTOU window between
-- findFirst and create would otherwise insert duplicate active rows.
CREATE UNIQUE INDEX "CostCenter_organizationId_name_active_key"
  ON "CostCenter" ("organizationId", "name")
  WHERE "archivedAt" IS NULL;
