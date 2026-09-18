-- Keep legacy directory identifiers unique without conflating concrete directories.
BEGIN;
CREATE UNIQUE INDEX "Group_legacy_organizationId_externalId_key"
ON "Group" ("organizationId", "externalId")
WHERE "scimConnectionId" IS NULL;

DROP INDEX "Group_organizationId_externalId_key";
COMMIT;
