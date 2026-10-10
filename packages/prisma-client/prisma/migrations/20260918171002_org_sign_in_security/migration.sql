-- Two sign-in security rules an organization can set, and the state behind
-- the first of them.
--
--   GAC-09, account lock-out: specs/identity/org-account-lockout.feature
--   GAC-10, session lifetime: specs/identity/org-session-lifetime.feature
--
-- ADDITIVE, AND IT CHANGES NOTHING FOR ANY ORGANIZATION THAT EXISTS. Zero
-- means "no rule" for all three thresholds, every existing row gets zero, and
-- so this migration ends no session and locks nobody out on deploy.
--
-- Organizations created AFTER it are the one difference: they start with a
-- one-day idle window, set by the `ALTER COLUMN ... SET DEFAULT` below rather
-- than by the `ADD COLUMN` above, for the reason written there.
--
-- `lockoutMinutes` defaults to 30 rather than 0 because it is only read once
-- a threshold is set, and 30 is the number the control names - so an
-- administrator who sets only the threshold gets the documented behaviour
-- rather than a lock that lifts instantly.

ALTER TABLE "Organization"
  ADD COLUMN "lockoutAfterFailedAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockoutMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "sessionIdleTimeoutMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sessionMaxLifetimeMinutes" INTEGER NOT NULL DEFAULT 0;

-- A DAY FOR ORGANIZATIONS MADE FROM NOW ON, and nothing at all for the ones
-- that already exist.
--
-- TWO STATEMENTS BECAUSE ONE WOULD NOT DO IT. `ADD COLUMN NOT NULL DEFAULT n`
-- writes `n` into every row that is already there, so declaring the day up in
-- the block above would have bounded every existing organization's sessions
-- on deploy and signed out everybody idle past it - the one thing the comment
-- above promises this migration does not do. Adding the column at zero and
-- moving the default afterwards leaves existing rows at zero, which still
-- means "no rule", and gives the new default only to rows inserted later.
--
-- A day rather than an hour: it ends the browser somebody left open on a
-- train without touching anyone working normally, and an organization that
-- wants the hour sets it.
ALTER TABLE "Organization"
  ALTER COLUMN "sessionIdleTimeoutMinutes" SET DEFAULT 1440;

-- When a session was last used, for the idle timeout above.
--
-- A column of our own rather than `updatedAt`, which better-auth rolls only
-- once per `updateAge` - a day - and so cannot tell an idle hour from an idle
-- minute. NULL on every existing session and on every session under no
-- window; a NULL reads as `updatedAt`, which is never earlier than the real
-- last use, so adding this column signs nobody out.
ALTER TABLE "Session"
  ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- Consecutive failed sign-ins, and the lock they earn.
--
-- KEYED ON THE ADDRESS THAT WAS TYPED, not on a user, and `userId` is
-- nullable for exactly that reason: an address with no account behind it is
-- counted, locked and refused like one that resolves, so a lock-out cannot be
-- used to discover who has an account here.
--
-- `identifierHash` is an HMAC of the normalised address under the
-- deployment's own secret, never the address. Without the key this table
-- would be a recoverable list of every address anybody has ever tried to sign
-- in as.
CREATE TABLE "SignInAttemptLock" (
  "id" TEXT NOT NULL,
  "identifierHash" TEXT NOT NULL,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "consecutiveLockouts" INTEGER NOT NULL DEFAULT 0,
  "heldForReview" BOOLEAN NOT NULL DEFAULT false,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SignInAttemptLock_pkey" PRIMARY KEY ("id")
);

-- The lookup every sign-in attempt makes, and what makes two attempts racing
-- for one address an update rather than a second row.
CREATE UNIQUE INDEX "SignInAttemptLock_identifierHash_key"
  ON "SignInAttemptLock"("identifierHash");

-- The reaper's read: rows whose lock has lifted and which are not held.
CREATE INDEX "SignInAttemptLock_lockedUntil_idx"
  ON "SignInAttemptLock"("lockedUntil");

-- An administrator releasing somebody names a person, not a hash.
CREATE INDEX "SignInAttemptLock_userId_idx"
  ON "SignInAttemptLock"("userId");
