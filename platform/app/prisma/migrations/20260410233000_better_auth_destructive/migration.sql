-- BetterAuth cutover — destructive schema changes (Phase 3, part 1 of 2).
--
-- This migration ships alongside the consumer swap. It:
--   1. Moves credential passwords from "User"."password" to "Account"."password"
--      as rows with providerId='credential', accountId=User.id.
--   2. Drops "User"."password".
--   3. Truncates "Session" — force-logout on deploy (approved by user).
--   4. Converts "User"."emailVerified" from DateTime? to Boolean.
--
-- This migration REQUIRES that the earlier `better_auth_additive` migration
-- has been applied (which adds "Account"."password").
--
-- Down migration is intentionally omitted — this is a one-way cutover.

-- 1+2. Copy credential passwords into Account as a 'credential' provider
--      row, then drop User.password. Idempotent: if re-run after step 2
--      completed, the User.password column no longer exists, so we skip
--      the copy and the drop is already a no-op via IF EXISTS. Wrapped in
--      a DO block so the column-existence check gates the INSERT — without
--      this, re-running a half-completed migration would fail on `SELECT
--      "password" FROM "User"` (column not found).
--      Deterministic `id = 'cred_' || user.id` so repeats are no-ops via
--      the unique(provider, accountId) index.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'User'
      AND column_name = 'password'
  ) THEN
    INSERT INTO "Account" (
      "id",
      "userId",
      "type",
      "provider",
      "providerAccountId",
      "password",
      "createdAt",
      "updatedAt"
    )
    SELECT
      'cred_' || "id",
      "id",
      'credential',
      'credential',
      "id",
      "password",
      NOW(),
      NOW()
    FROM "User"
    WHERE "password" IS NOT NULL
    ON CONFLICT ("provider", "providerAccountId") DO NOTHING;

    ALTER TABLE "User" DROP COLUMN "password";
  END IF;
END $$;

-- 3. Force-logout: drop all live sessions. Users will re-authenticate after deploy.
TRUNCATE "Session";

-- 4. Convert User.emailVerified from DateTime? to Boolean (idempotent).
--    Postgres can't cast NULL DateTime to Boolean directly; use an expression
--    and a temporary column swap. Wrapped in a DO block that checks whether
--    the swap has already been performed, so the whole migration can be
--    safely re-run if a previous attempt crashed partway. Re-runnable
--    migrations are important during cutover: if Prisma fails mid-migration
--    (db blip, timeout), `prisma migrate deploy` retries the whole file, and
--    non-idempotent steps would fail with confusing errors on the second
--    run ("column does not exist").
DO $$
DECLARE
  column_type TEXT;
BEGIN
  SELECT data_type INTO column_type
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'User'
    AND column_name = 'emailVerified';

  -- If the column is still the old DateTime type, do the swap. If it's
  -- already boolean (from a previous successful run), or missing entirely
  -- because of a half-finished previous attempt, skip or clean up.
  IF column_type = 'timestamp without time zone' OR column_type = 'timestamp with time zone' THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified_new" BOOLEAN NOT NULL DEFAULT false;
    UPDATE "User" SET "emailVerified_new" = ("emailVerified" IS NOT NULL);
    ALTER TABLE "User" DROP COLUMN "emailVerified";
    ALTER TABLE "User" RENAME COLUMN "emailVerified_new" TO "emailVerified";
  ELSIF column_type IS NULL THEN
    -- Column does not exist at all. Could happen if a previous run DROPPED
    -- the column but crashed before the RENAME. Recover the emailVerified_new
    -- column by renaming it, if present; otherwise create a fresh one.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'User'
        AND column_name = 'emailVerified_new'
    ) THEN
      ALTER TABLE "User" RENAME COLUMN "emailVerified_new" TO "emailVerified";
    ELSE
      ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
    END IF;
  ELSE
    -- Already boolean. Clean up any orphaned temporary column from a
    -- crashed previous attempt.
    ALTER TABLE "User" DROP COLUMN IF EXISTS "emailVerified_new";
  END IF;
END $$;
