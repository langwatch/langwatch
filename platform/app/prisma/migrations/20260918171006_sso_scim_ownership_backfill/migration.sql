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
-- Name them, so an operator reads which connections to restore instead of a
-- bare not-null violation on a table of millions.
DO $$
DECLARE
  connections TEXT[];
  total INTEGER;
BEGIN
  SELECT array_agg("connectionId" ORDER BY "connectionId"), count(*)
  INTO connections, total
  FROM (
    SELECT "connectionId" FROM "ScimDirectoryUser" WHERE "organizationId" IS NULL
    UNION
    SELECT "connectionId" FROM "ScimExternalId" WHERE "organizationId" IS NULL
  ) AS unowned;

  IF total > 0 THEN
    RAISE EXCEPTION
      'SCIM directory identities name % connection(s) absent from "SsoConnection"; restore or delete those rows before upgrading — the tenant is not guessable. First 20: %',
      total, array_to_string(connections[1:20], ', ');
  END IF;
END $$;

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

-- To roll back, uncomment and run manually, before starting the previous
-- release's image. Reverses in the order the statements above applied. The
-- domain rows stay: this migration only inserted ones that were missing, and
-- deleting them would discard sign-in routes that may have been there first.
-- DROP INDEX "ScimExternalId_organizationId_userId_idx";
-- DROP INDEX "ScimDirectoryUser_organizationId_userId_idx";
-- CREATE INDEX "ScimDirectoryUser_userId_idx" ON "ScimDirectoryUser"("userId");
-- ALTER TABLE "ScimExternalId" DROP COLUMN "organizationId";
-- ALTER TABLE "ScimDirectoryUser" DROP COLUMN "organizationId";
--
-- The minimal alternative, when the rollback is expected to be re-upgraded:
-- the previous release inserts into both tables without naming
-- "organizationId", so dropping the NOT NULL alone keeps provisioning working
-- and keeps the backfilled tenants. Prefer it, because a re-upgrade re-runs
-- nothing — this migration's "_prisma_migrations" row survives a full undo,
-- so after one the columns have to be rebuilt by hand or that row deleted.
-- ALTER TABLE "ScimExternalId" ALTER COLUMN "organizationId" DROP NOT NULL;
-- ALTER TABLE "ScimDirectoryUser" ALTER COLUMN "organizationId" DROP NOT NULL;
