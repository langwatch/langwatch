-- When an operator marked this person's password as no longer trusted. NULL
-- on every existing row: nobody is marked until the require-password-reset
-- task runs. Spec: modules/auth/specs/forced-password-reset.feature

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordResetRequiredAt" TIMESTAMP(3);
