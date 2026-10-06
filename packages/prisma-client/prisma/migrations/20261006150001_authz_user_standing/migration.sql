CREATE TABLE "AuthzUserStanding" (
    "userId" TEXT NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "erasedAt" TIMESTAMP(3),
    "standingChangedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthzUserStanding_pkey" PRIMARY KEY ("userId")
);

-- One-time backfill: users already deactivated stay inactive to authz from the first deploy.
INSERT INTO "AuthzUserStanding" ("userId", "deactivatedAt", "standingChangedAt")
SELECT "id", "deactivatedAt", "deactivatedAt" FROM "User" WHERE "deactivatedAt" IS NOT NULL;
