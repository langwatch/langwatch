-- When an operator marked this person's password as no longer trusted. NULL
-- on every existing row: nobody is marked until the require-password-reset
-- task runs. Spec: modules/auth/specs/forced-password-reset.feature

-- IRREVERSIBLE: expand-only, with no down step. The column is nullable and no
-- migration drops it; removing it is an operator step once no release reads it.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordResetRequiredAt" TIMESTAMP(3);
