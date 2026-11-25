-- The auth module marks the session a sign-up started, so the secure-account offer waits for the
-- next sign-in (specs/identity/passkeys.feature). A constant default: no rewrite, old rows read false.
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "startedBySignUp" BOOLEAN NOT NULL DEFAULT false;
