-- Claims are tenant-owned even though a user may belong to several tenants.
ALTER TABLE "ScimDirectoryUser" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "ScimExternalId" ADD COLUMN "organizationId" TEXT;

UPDATE "ScimDirectoryUser" AS claim
SET "organizationId" = connection."organizationId"
FROM "SsoConnection" AS connection
WHERE connection."id" = claim."connectionId";

UPDATE "ScimExternalId" AS identity
SET "organizationId" = connection."organizationId"
FROM "SsoConnection" AS connection
WHERE connection."id" = identity."connectionId";

-- Missing connections require operator repair rather than guessing a tenant.
ALTER TABLE "ScimDirectoryUser" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ScimExternalId" ALTER COLUMN "organizationId" SET NOT NULL;
DROP INDEX "ScimDirectoryUser_userId_idx";
CREATE INDEX "ScimDirectoryUser_organizationId_userId_idx" ON "ScimDirectoryUser"("organizationId", "userId");
CREATE INDEX "ScimExternalId_organizationId_userId_idx" ON "ScimExternalId"("organizationId", "userId");

-- Refuse conflicting tenant ownership. The unique domain key deliberately
-- fails instead of choosing which organization's sign-in route to discard.
INSERT INTO "SsoVerifiedDomain" ("domain", "organizationId")
SELECT DISTINCT domains.domain, connection."organizationId"
FROM "SsoConnection" AS connection
CROSS JOIN LATERAL unnest(connection."verifiedDomains") AS domains(domain)
WHERE connection."state" NOT IN ('DISCARDED', 'TORN_DOWN')
  AND NOT EXISTS (
    SELECT 1 FROM "SsoVerifiedDomain" AS owner
    WHERE owner."domain" = domains.domain
      AND owner."organizationId" = connection."organizationId"
  );

INSERT INTO "SsoVerifiedDomainHolder" ("domain", "connectionId", "organizationId")
SELECT DISTINCT domains.domain, connection."id", connection."organizationId"
FROM "SsoConnection" AS connection
CROSS JOIN LATERAL unnest(connection."verifiedDomains") AS domains(domain)
WHERE connection."state" NOT IN ('DISCARDED', 'TORN_DOWN')
ON CONFLICT ("domain", "connectionId") DO NOTHING;
