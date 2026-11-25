-- Convert Account.expires_at from Int (NextAuth's Unix-epoch-seconds
-- convention) to DateTime (BetterAuth writes Date objects). Without this
-- the OAuth callback crashes with PrismaClientValidationError:
-- "Expected Int or Null, provided DateTime". Bug 39 in the migration audit.
--
-- Idempotent: if the column is ALREADY a timestamp type (from a prior
-- apply of this migration or from a manual fix), the DO block skips the
-- conversion.

DO $$
BEGIN
  -- Only convert if the column is currently an integer type.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Account'
      AND column_name = 'expires_at'
      AND data_type IN ('integer', 'bigint')
  ) THEN
    -- Add a temporary DateTime column.
    ALTER TABLE "Account" ADD COLUMN "expires_at_tmp" TIMESTAMP(3);

    -- Convert existing Unix-epoch-seconds to timestamps. The
    -- `to_timestamp(int)` function interprets the integer as seconds
    -- since 1970-01-01 00:00:00 UTC.
    UPDATE "Account"
    SET "expires_at_tmp" = to_timestamp("expires_at")
    WHERE "expires_at" IS NOT NULL;

    -- Drop the old Int column and rename the new one.
    ALTER TABLE "Account" DROP COLUMN "expires_at";
    ALTER TABLE "Account" RENAME COLUMN "expires_at_tmp" TO "expires_at";
  END IF;
END $$;
