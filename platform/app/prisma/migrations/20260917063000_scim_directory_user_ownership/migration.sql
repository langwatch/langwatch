CREATE TABLE "ScimDirectoryUser" (
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ScimDirectoryUser_pkey" PRIMARY KEY ("connectionId", "userId")
);

CREATE INDEX "ScimDirectoryUser_userId_idx" ON "ScimDirectoryUser"("userId");

-- Existing external identifiers prove ownership. Users pushed without one
-- are adopted on their next successful push; their connection is not guessed.
INSERT INTO "ScimDirectoryUser" ("connectionId", "userId")
SELECT DISTINCT "connectionId", "userId"
FROM "ScimExternalId"
ON CONFLICT ("connectionId", "userId") DO NOTHING;
