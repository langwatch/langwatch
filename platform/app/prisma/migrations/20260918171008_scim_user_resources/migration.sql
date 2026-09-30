CREATE TABLE "ScimUserResource" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScimUserResource_pkey" PRIMARY KEY ("organizationId", "userId")
);

CREATE INDEX "ScimUserResource_organizationId_userName_idx" ON "ScimUserResource"("organizationId", "userName");
CREATE INDEX "ScimUserResource_userId_idx" ON "ScimUserResource"("userId");

-- Accounts are unique on a case-sensitive email, the alias index below is not.
-- Two accounts claimed by one tenant whose emails differ only in case would
-- lose one to a silent dedupe, so name them and refuse instead.
DO $$
DECLARE
  aliases TEXT[];
  total INTEGER;
BEGIN
  SELECT array_agg(alias ORDER BY alias), count(*)
  INTO aliases, total
  FROM (
    SELECT claims."organizationId" || ' / ' || lower(btrim(account."email")) AS alias
    FROM (
      SELECT "organizationId", "userId" FROM "ScimDirectoryUser"
      UNION
      SELECT "organizationId", "userId" FROM "ScimExternalId"
    ) AS claims
    JOIN "User" AS account ON account."id" = claims."userId"
    WHERE btrim(COALESCE(account."email", '')) <> ''
    GROUP BY claims."organizationId", lower(btrim(account."email"))
    HAVING count(DISTINCT claims."userId") > 1
  ) AS collisions;

  IF total > 0 THEN
    RAISE EXCEPTION
      'SCIM user resources collide on % tenant alias(es) held by accounts whose emails differ only in case; merge or rename those accounts before upgrading. First 20: %',
      total, array_to_string(aliases[1:20], ', ');
  END IF;
END $$;

-- Preserve historical disables; a tenant migration must never reactivate a global account.
INSERT INTO "ScimUserResource" ("organizationId", "userId", "userName", "name", "active", "createdAt", "updatedAt")
SELECT claims."organizationId", account."id", lower(trim(COALESCE(account."email", ''))), account."name",
       account."deactivatedAt" IS NULL, account."createdAt", account."updatedAt"
FROM (
    SELECT "organizationId", "userId" FROM "ScimDirectoryUser"
    UNION
    SELECT "organizationId", "userId" FROM "ScimExternalId"
) AS claims
JOIN "User" AS account ON account."id" = claims."userId";

-- Deleted resources release their aliases; historical missing emails remain readable.
CREATE UNIQUE INDEX "ScimUserResource_organizationId_userName_live_key"
ON "ScimUserResource" ("organizationId", lower(btrim("userName")))
WHERE "deletedAt" IS NULL AND btrim("userName") <> '';

-- To roll back, uncomment and run manually, before starting the previous
-- release's image. The table is a projection of directory claims and
-- accounts, and nothing else reads it; re-running the INSERT above rebuilds
-- it. Dropping it takes its two indexes and the live-alias key with it.
-- DROP TABLE "ScimUserResource";
