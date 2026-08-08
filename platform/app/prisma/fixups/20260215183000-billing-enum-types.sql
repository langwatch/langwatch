-- Pre-migrate fixup for migrations/20260215183000_add_billing_schema_to_oss.
--
-- That migration creates "PlanTypes", "SubscriptionStatus" and "Currency" via
-- a guarded DO block and uses them later in the same file. On a database
-- that already has these types from an earlier path this is a no-op and the
-- file works fine, which is every database it has actually run against so
-- far. On a genuinely fresh database, `prisma migrate deploy` fails applying
-- it with P3018 ("type \"Currency\" does not exist"): Prisma's migration
-- engine does not see a type created inside a DO block as visible to a later
-- statement in the same file, even though the identical SQL runs cleanly
-- statement-by-statement through plain psql.
--
-- The obvious fix is a new migration that creates these types and runs
-- before 20260215183000. That is not available here: this repo's
-- migration-order check (.github/workflows/migration-order.yml) hard-fails
-- any new migration numbered below the current tip of main, with no
-- override, because ClickHouse/goose genuinely skips a migration numbered
-- below a version the database is already on. A new Prisma migration would
-- have to sort after 20260804120000 (or later), i.e. after
-- 20260215183000 already ran and failed, which is too late to help.
-- 20260215183000 itself is already deployed and immutable per this repo's
-- "never edit a deployed migration" rule, so it cannot be fixed in place
-- either.
--
-- So this runs as a separate step, before `prisma migrate deploy`, outside
-- the migrations system entirely: same idempotent guards, applied via
-- `prisma db execute` (see the prisma:migrate script in package.json) so the
-- types are durably committed in their own statement before
-- 20260215183000's statements are ever parsed. Safe to run against any
-- database, including ones that already have these types.

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
