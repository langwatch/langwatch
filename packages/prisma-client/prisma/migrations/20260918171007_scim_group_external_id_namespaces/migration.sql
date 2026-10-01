-- Keep legacy directory identifiers unique without conflating concrete directories.
CREATE UNIQUE INDEX "Group_legacy_organizationId_externalId_key"
ON "Group" ("organizationId", "externalId")
WHERE "scimConnectionId" IS NULL;

DROP INDEX "Group_organizationId_externalId_key";

-- To roll back, uncomment and run manually, before starting the previous
-- release's image. Restoring the organization-wide key fails if two
-- connections in one organization already carry the same externalId; those
-- groups are exactly what this migration made expressible, so resolve them
-- first. Create before dropping, so the uniqueness is never unguarded.
-- CREATE UNIQUE INDEX "Group_organizationId_externalId_key" ON "Group"("organizationId", "externalId");
-- DROP INDEX "Group_legacy_organizationId_externalId_key";
