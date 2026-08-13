-- Drop two RoutingPolicy columns that never reached the gateway.
--
-- "modelAllowlist" was a list of glob patterns nothing ever read. The
-- allowlist the gateway enforces is models_allowed on the virtual key; the
-- materialiser has never emitted this column. So it denies nothing, and a
-- policy carrying entries is enforcing less than its author believes.
--
-- "strategy" named four routing strategies (priority, cost, latency,
-- round_robin). Only the first exists, as the plain order of
-- modelProviderIds, and the column was never emitted either.
--
-- Deliberately NOT backfilled into policyRules.models.allow. Because the
-- allowlist denies nothing today, folding it into the rules that ARE enforced
-- would start refusing live traffic on deploy day.
-- platform/app/scripts/report-routing-policy-dead-fields.ts reports what is
-- being dropped and, with --emit-sql, prints the per-policy patch for support
-- to apply where an organization actually wants the allowlist enforced.
--
-- Production counts at the time of the drop are recorded in the pull request
-- that carries this migration.
--
-- To roll back, uncomment and run manually. The data is not recoverable from
-- here; restore it from a backup if it is ever needed.
-- ALTER TABLE "RoutingPolicy" ADD COLUMN "modelAllowlist" JSONB;
-- ALTER TABLE "RoutingPolicy" ADD COLUMN "strategy" TEXT NOT NULL DEFAULT 'priority';

ALTER TABLE "RoutingPolicy" DROP COLUMN "modelAllowlist";

ALTER TABLE "RoutingPolicy" DROP COLUMN "strategy";
