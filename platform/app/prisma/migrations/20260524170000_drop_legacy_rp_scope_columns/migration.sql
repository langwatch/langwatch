-- Drop legacy RoutingPolicy.scope + RoutingPolicy.scopeId columns.
--
-- Multi-scope assignments now live exclusively in `RoutingPolicyScope`
-- (backfilled by 20260524162000_routing_policy_scope). Step (vb) shipped
-- the service-layer switch (be3ef90d4); the mirror-write that kept these
-- two columns aligned with the first scope row is being removed in the
-- same patch as this migration.
--
-- Safety: if any RP row exists whose first scope row no longer matches
-- the legacy {scope, scopeId} tuple, the schema is in an inconsistent
-- state — bail rather than silently drop divergent state.
DO $$
DECLARE
  drift_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO drift_count
  FROM "RoutingPolicy" rp
  WHERE NOT EXISTS (
    SELECT 1 FROM "RoutingPolicyScope" rps
    WHERE rps."routingPolicyId" = rp.id
      AND rps."scopeType"::text = rp.scope::text
      AND rps."scopeId" = rp."scopeId"
  );

  IF drift_count > 0 THEN
    RAISE EXCEPTION 'RoutingPolicy legacy columns diverge from RoutingPolicyScope on % row(s); refusing to drop. Backfill first via scripts/migrations/backfill-rp-scope.ts (or inspect manually).', drift_count;
  END IF;
END $$;

-- Drop the legacy composite uniqueness on (org, scope, scopeId, name).
-- Replaced by a per-(org, scope-row, name) invariant enforced at the
-- application layer; the RoutingPolicyScope @@unique already guarantees
-- no duplicate scope rows.
DROP INDEX IF EXISTS "RoutingPolicy_organizationId_scope_scopeId_name_key";

-- Drop the legacy lookup index — every consumer now queries through
-- RoutingPolicyScope, which has its own (scopeType, scopeId) index.
DROP INDEX IF EXISTS "RoutingPolicy_scope_scopeId_idx";

ALTER TABLE "RoutingPolicy" DROP COLUMN "scope";
ALTER TABLE "RoutingPolicy" DROP COLUMN "scopeId";

-- To roll back, uncomment and run manually:
-- ALTER TABLE "RoutingPolicy" ADD COLUMN "scope" "RoutingPolicyScopeType";
-- ALTER TABLE "RoutingPolicy" ADD COLUMN "scopeId" TEXT;
-- UPDATE "RoutingPolicy" rp SET
--   scope = (SELECT "scopeType" FROM "RoutingPolicyScope" rps WHERE rps."routingPolicyId" = rp.id ORDER BY rps."createdAt" ASC LIMIT 1),
--   "scopeId" = (SELECT "scopeId" FROM "RoutingPolicyScope" rps WHERE rps."routingPolicyId" = rp.id ORDER BY rps."createdAt" ASC LIMIT 1);
-- ALTER TABLE "RoutingPolicy" ALTER COLUMN scope SET NOT NULL;
-- ALTER TABLE "RoutingPolicy" ALTER COLUMN "scopeId" SET NOT NULL;
-- CREATE UNIQUE INDEX "RoutingPolicy_organizationId_scope_scopeId_name_key" ON "RoutingPolicy"("organizationId", scope, "scopeId", name);
-- CREATE INDEX "RoutingPolicy_scope_scopeId_idx" ON "RoutingPolicy"(scope, "scopeId");
