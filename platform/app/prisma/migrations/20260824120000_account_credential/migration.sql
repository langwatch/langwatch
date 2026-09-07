-- ADR-116 §1: the credential half of `Account`, on its own table.
--
-- The identity storage adapter serves better-auth's `account` model for a
-- finalized user from `Identifier` (linkage, event-truth) joined to this
-- table (secrets, row-truth). Secrets can never be events - ADR-101's
-- payload rule bars them, and OAuth refresh rewrites them on a cadence no
-- event log should carry - so they get a table rather than a projection.
--
-- `id` IS the pinned account id the attach fact carries
-- (`Identifier.accountId`), which doubles as the `Account` row's id while
-- the bridge table exists. Nothing is re-keyed.
--
-- Additive and dark: the write gate ships closed, so no user takes the
-- identity branch and nothing writes this table until an operator enrolls
-- one. Carrying an existing user's secrets across at latch is the
-- finalization step's work, not this migration's.
--
-- To roll back, uncomment and run manually. The table is additive and
-- nothing outside identity reads it.
-- DROP TABLE "AccountCredential";

-- CreateTable
CREATE TABLE "AccountCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "password" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountCredential_pkey" PRIMARY KEY ("id")
);

-- Scopes the account list and the fan-out a user delete performs.
-- CreateIndex
CREATE INDEX "AccountCredential_userId_idx" ON "AccountCredential"("userId");
