-- Split out of 20260215183000_add_billing_schema_to_oss, which creates
-- "PlanTypes", "SubscriptionStatus" and "Currency" via a guarded DO block and
-- then uses them later in the SAME migration file (an ALTER TABLE for
-- Currency, a CREATE TABLE for the other two). On a database that already
-- has these types from an earlier path, that is a no-op and the file works
-- fine. On a genuinely fresh database, `prisma migrate deploy` fails
-- applying that migration with P3018 ("type \"Currency\" does not exist"):
-- the type created earlier in the file is not visible yet to the later
-- statement that uses it, even though the identical SQL runs cleanly
-- statement-by-statement through plain psql. Creating the types in their own
-- prior migration makes them durably committed before
-- 20260215183000_add_billing_schema_to_oss ever runs, sidestepping the
-- issue. That migration is already deployed and immutable, so it keeps its
-- own (now-redundant but harmless, still guarded) copies of these DO blocks.
--
-- Idempotent for the same reason the original blocks were: safe to run
-- against databases where these types already exist.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlanTypes') THEN
    CREATE TYPE "PlanTypes" AS ENUM (
      'FREE',
      'PRO',
      'GROWTH',
      'ENTERPRISE',
      'LAUNCH',
      'ACCELERATE',
      'LAUNCH_ANNUAL',
      'ACCELERATE_ANNUAL'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'FAILED', 'ACTIVE', 'CANCELLED');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Currency') THEN
    CREATE TYPE "Currency" AS ENUM ('USD', 'EUR');
  END IF;
END$$;
