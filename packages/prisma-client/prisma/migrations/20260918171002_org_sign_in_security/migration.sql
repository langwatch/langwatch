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
