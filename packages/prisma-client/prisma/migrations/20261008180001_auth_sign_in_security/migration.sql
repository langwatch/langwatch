-- Sign-in security state owned by auth: the session's last-use stamp and the
-- failed-attempt lock. The organization's own rules are in the migration before.
--   GAC-09: specs/identity/org-account-lockout.feature
--   GAC-10: specs/identity/org-session-lifetime.feature

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
