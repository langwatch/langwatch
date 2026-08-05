-- Per-organization membership disable, used to reconcile an organization down
-- to its licensed seat count. Nullable and defaulting to NULL, so every
-- existing membership stays active.
--
-- No new index: the reads that filter on this all scope to one organization
-- first, which the existing OrganizationUser_organizationId_idx already serves.
ALTER TABLE "OrganizationUser" ADD COLUMN "disabledAt" TIMESTAMP(3);
