-- BetterAuth cutover — additive schema changes (Phase 2).
--
-- Makes the schema forward-compatible with BetterAuth WITHOUT breaking the
-- running NextAuth codebase. Purely additive, idempotent, reversible.
--
-- The destructive changes (drop User.password, convert emailVerified from
-- DateTime? to Boolean, truncate Session) happen in a follow-up migration
-- `better_auth_cutover_destructive` that ships alongside the consumer swap.

-- 1. Account.password — BetterAuth stores credential passwords here.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "password" TEXT;

-- 2. Account.type defaults to "oauth" so BetterAuth can insert rows without
--    supplying it. Existing rows keep their values.
ALTER TABLE "Account" ALTER COLUMN "type" SET DEFAULT 'oauth';

-- 3. Session.ipAddress / userAgent — BetterAuth records these on session create.
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;

-- 4. Session.createdAt / updatedAt — BetterAuth expects timestamps on sessions.
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 5. VerificationToken.id — BetterAuth requires a single-column primary key.
--    The existing composite @@unique([identifier, token]) is kept as a unique
--    constraint. Backfill existing rows with unique ids. We use md5(random()::text)
--    instead of gen_random_bytes() because the latter requires the pgcrypto
--    extension which isn't guaranteed on every deployment target (RDS, on-prem,
--    local dev containers). md5() is core Postgres and always available.
ALTER TABLE "VerificationToken" ADD COLUMN IF NOT EXISTS "id" TEXT;
UPDATE "VerificationToken"
  SET "id" = md5(random()::text || clock_timestamp()::text)
  WHERE "id" IS NULL;
ALTER TABLE "VerificationToken" ALTER COLUMN "id" SET NOT NULL;

-- Drop the old implicit composite PK (there isn't one in Postgres, but the
-- Prisma model previously had no @id — adding one now) and add the new PK.
-- Use `IF NOT EXISTS` guard for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'VerificationToken_pkey'
  ) THEN
    ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id");
  END IF;
END$$;

-- 6. VerificationToken timestamps.
ALTER TABLE "VerificationToken" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "VerificationToken" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
