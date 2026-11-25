-- better-auth stores plain values in "token" (a user id per two-step challenge, an attempt
-- counter), so a unique index on it alone 500s a second challenge (WEB-19201).
-- The (identifier, token) unique index stays.
DROP INDEX IF EXISTS "VerificationToken_token_key";
