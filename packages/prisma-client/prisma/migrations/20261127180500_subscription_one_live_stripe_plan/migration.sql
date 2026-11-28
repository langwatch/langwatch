-- One live Stripe-backed plan per organization: two checkouts paid at once, or a reactivation
-- beside a live plan, cannot both land. Tiered plans are left out: a paid seat checkout is
-- activated before it retires the tiered plan it replaces. An organization that already holds
-- several keeps its newest inside the index; the older ones are named in the predicate so the
-- build never fails, and the billing duplicate-subscriptions report lists them for ops. They are
-- never cancelled here: each is a customer's Stripe subscription, which support resolves. Until
-- then billing's own live-plan check still refuses a new plan beside one, and once resolved ops
-- rebuild the index with the plain predicate below.
--
-- ops pre-build: run the query below; with no rows, build
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Subscription_one_live_stripe_plan_key" ON "Subscription" ("organizationId") WHERE "status" = 'ACTIVE' AND "stripeSubscriptionId" IS NOT NULL AND "plan" NOT IN ('LAUNCH', 'ACCELERATE', 'LAUNCH_ANNUAL', 'ACCELERATE_ANNUAL', 'PRO', 'GROWTH');
-- and with rows, append AND "id" NOT IN (<those ids>) to that predicate:
--   SELECT "id" FROM (SELECT "id", row_number() OVER (PARTITION BY "organizationId" ORDER BY "createdAt" DESC, "id" DESC) AS "rank" FROM "Subscription" WHERE "status" = 'ACTIVE' AND "stripeSubscriptionId" IS NOT NULL AND "plan" NOT IN ('LAUNCH', 'ACCELERATE', 'LAUNCH_ANNUAL', 'ACCELERATE_ANNUAL', 'PRO', 'GROWTH')) AS "ranked" WHERE "rank" > 1;
-- A failed concurrent build leaves an invalid index under this name that IF NOT EXISTS skips:
-- check pg_index.indisvalid and DROP INDEX CONCURRENTLY before retrying.
DO $$
DECLARE
  older_duplicates TEXT;
BEGIN
  SELECT string_agg(quote_literal("id"), ', ' ORDER BY "id")
    INTO older_duplicates
    FROM (
      SELECT "id",
             row_number() OVER (
               PARTITION BY "organizationId" ORDER BY "createdAt" DESC, "id" DESC
             ) AS "rank"
        FROM "Subscription"
       WHERE "status" = 'ACTIVE'
         AND "stripeSubscriptionId" IS NOT NULL
         AND "plan" NOT IN ('LAUNCH', 'ACCELERATE', 'LAUNCH_ANNUAL', 'ACCELERATE_ANNUAL', 'PRO', 'GROWTH')
    ) AS "ranked"
   WHERE "rank" > 1;

  IF older_duplicates IS NOT NULL THEN
    RAISE WARNING 'Subscription_one_live_stripe_plan_key leaves out older duplicate live plans for support to resolve: %', older_duplicates;
  END IF;

  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON "Subscription" ("organizationId") '
      || 'WHERE "status" = %L AND "stripeSubscriptionId" IS NOT NULL '
      || 'AND "plan" NOT IN (''LAUNCH'', ''ACCELERATE'', ''LAUNCH_ANNUAL'', ''ACCELERATE_ANNUAL'', ''PRO'', ''GROWTH'')%s',
    'Subscription_one_live_stripe_plan_key',
    'ACTIVE',
    CASE
      WHEN older_duplicates IS NULL THEN ''
      ELSE format(' AND "id" NOT IN (%s)', older_duplicates)
    END
  );
END $$;