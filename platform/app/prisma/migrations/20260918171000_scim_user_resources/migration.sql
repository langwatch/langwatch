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
