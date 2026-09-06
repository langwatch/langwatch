-- RoutingPolicy gets a multi-scope join table mirroring VirtualKeyScope
-- + ModelProviderScope. The legacy `scope` + `scopeId` columns on
-- RoutingPolicy stay for now; the service-layer switch + column drop
-- lands in a follow-up migration once consumers are updated.
--
-- Selectability rule (per ariana spec L20-21):
--   A VK at scope S can select a RoutingPolicy P iff at least one of
--   P's scope rows is an ancestor of S or equal to S.
--
-- Backfill: every existing RoutingPolicy row gets one
-- RoutingPolicyScope row seeded from its legacy `scope` + `scopeId`
-- columns so existing selectability is preserved on day one.
--
-- relationMode="prisma" means no SQL FK constraint is emitted.
-- ON DELETE CASCADE semantics for the parent RoutingPolicy live in
-- the Prisma client (the `routingPolicy.delete` call cascades scope
-- rows at the ORM layer).
--
-- Forward-only. Down migration would be DROP TABLE
-- "RoutingPolicyScope"; commented out per CLAUDE.md convention.

CREATE TABLE "RoutingPolicyScope" (
  "id" TEXT NOT NULL,
  "routingPolicyId" TEXT NOT NULL,
  "scopeType" "RoutingPolicyScopeType" NOT NULL,
  "scopeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoutingPolicyScope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoutingPolicyScope_routingPolicyId_scopeType_scopeId_key"
  ON "RoutingPolicyScope"("routingPolicyId", "scopeType", "scopeId");

CREATE INDEX "RoutingPolicyScope_scopeType_scopeId_idx"
  ON "RoutingPolicyScope"("scopeType", "scopeId");

CREATE INDEX "RoutingPolicyScope_routingPolicyId_idx"
  ON "RoutingPolicyScope"("routingPolicyId");

-- Backfill: one scope row per existing RP, seeded from the legacy
-- scope + scopeId columns. `gen_random_uuid()::text` keeps id shape
-- consistent with nanoid call sites (downstream code reads strings,
-- not UUIDs, but Postgres-side either works).
INSERT INTO "RoutingPolicyScope" ("id", "routingPolicyId", "scopeType", "scopeId", "createdAt")
SELECT
  'rps_' || replace(gen_random_uuid()::text, '-', ''),
  "id",
  "scope",
  "scopeId",
  "createdAt"
FROM "RoutingPolicy";
