-- ADR-116: `Account` splits along the truth line. The LINKAGE half - who
-- holds which sign-in method - is `Identifier`, built by the fold from the
-- event log. This table is the CREDENTIAL half: row-truth secrets that can
-- never be events (the payload rule) and that OAuth refresh rewrites on a
-- cadence events should never carry.
--
-- Additive and dark. `Account` is untouched and stays authoritative for every
-- user until their backfill finalizes; the adapter reads the projection first
-- and falls through to `Account` for everyone else. Nothing reads this table
-- until IdentityAccountAdapter is wired.
--
-- `id` IS the old `Account.id` - `Identifier.accountId` already points at it,
-- so better-auth's account id keeps its meaning and nothing is re-keyed.
--
-- To roll back, uncomment and run manually. Dropping the table loses only the
-- copy: every row here was seeded from `Account`, which is not modified.
-- DROP TABLE "AccountCredential";

-- The provider's own subject on the projection. An IdP callback arrives
-- holding `(providerId, accountId)`, so without this column the projection
-- cannot say who is signing in and the legacy Account row stays the only
-- answer - which is the duplication ADR-116 removes. Safe to add now and not
-- later: the write gate ships closed, so no identity event has ever been
-- emitted and there is no history to re-state.
-- AlterTable
ALTER TABLE "Identifier" ADD COLUMN "providerAccountId" TEXT;

-- CreateIndex
CREATE INDEX "Identifier_provider_providerAccountId_idx" ON "Identifier"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "Identifier_accountId_idx" ON "Identifier"("accountId");

-- Seed it from the rows the identifiers were adopted from, so an already
-- backfilled user does not have to wait for their next pass.
UPDATE "Identifier" i
SET "providerAccountId" = a."providerAccountId"
FROM "Account" a
WHERE i."accountId" = a."id" AND i."providerAccountId" IS NULL;

-- CreateTable
CREATE TABLE "AccountCredential" (
    "id" TEXT NOT NULL,
    "identifierId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'oauth',
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "extExpiresIn" INTEGER,
    "tokenType" TEXT,
    "scope" TEXT,
    "idToken" TEXT,
    "sessionState" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountCredential_pkey" PRIMARY KEY ("id")
);

-- One credential row per identifier: the identifier IS the linkage, so two
-- credential rows claiming it would be the duplication this ADR removes.
-- CreateIndex
CREATE UNIQUE INDEX "AccountCredential_identifierId_key" ON "AccountCredential"("identifierId");

-- Seed from the identifiers the backfill has already adopted. An identifier
-- carries the `Account.id` it was adopted from, which is this row's id, so a
-- re-run inserts nothing new. Users the backfill has not reached yet have no
-- identifiers and are seeded when it reaches them.
INSERT INTO "AccountCredential" (
    "id", "identifierId", "type", "refreshToken", "accessToken", "expiresAt",
    "extExpiresIn", "tokenType", "scope", "idToken", "sessionState",
    "password", "createdAt", "updatedAt"
)
SELECT
    a."id", i."id", a."type", a."refresh_token", a."access_token",
    a."expires_at", a."ext_expires_in", a."token_type", a."scope",
    a."id_token", a."session_state", a."password", a."createdAt",
    a."updatedAt"
FROM "Account" a
JOIN "Identifier" i ON i."accountId" = a."id"
ON CONFLICT ("id") DO NOTHING;
