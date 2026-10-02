-- Project API keys move to hashed storage.
--
-- The hash is an HMAC keyed by the application's API key pepper, which only
-- the application holds, so this migration cannot compute it. It adds the
-- columns and relaxes NOT NULL on the plaintext. The application's
-- maintenance sweep (and the authentication path, for a key it sees before
-- the sweep does) writes the hash, then clears the plaintext a grace window
-- later. Until then the previous release keeps authenticating every key by
-- its plaintext, so a rolling deploy and a rollback inside the window are safe.
ALTER TABLE "Project" ALTER COLUMN "apiKey" DROP NOT NULL;

ALTER TABLE "Project"
  ADD COLUMN "apiKeyHash" TEXT,
  ADD COLUMN "apiKeyLast4" TEXT,
  ADD COLUMN "apiKeyHashedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Project_apiKeyHash_key" ON "Project"("apiKeyHash");

-- Display only, and computable here: no secret is involved.
UPDATE "Project" SET "apiKeyLast4" = right("apiKey", 4) WHERE "apiKey" IS NOT NULL;

CREATE TABLE "ProjectInternalKey" (
    "projectId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInternalKey_pkey" PRIMARY KEY ("projectId")
);

CREATE UNIQUE INDEX "ProjectInternalKey_tokenHash_key" ON "ProjectInternalKey"("tokenHash");

ALTER TABLE "ProjectInternalKey" ADD CONSTRAINT "ProjectInternalKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
