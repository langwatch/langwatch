-- AI Gateway cache-control rules
-- Contract: specs/ai-gateway/cache-control-rules.feature
-- Ref: docs/ai-gateway/cache-control.mdx §Cache rules

-- New mode enum for cache-rule actions (.modeEnum) -------------------------
CREATE TYPE "GatewayCacheRuleMode" AS ENUM ('RESPECT', 'FORCE', 'DISABLE');

-- Extend existing change-event + audit-action enums with cache-rule kinds --
ALTER TYPE "GatewayChangeEventKind" ADD VALUE 'CACHE_RULE_CREATED';
ALTER TYPE "GatewayChangeEventKind" ADD VALUE 'CACHE_RULE_UPDATED';
ALTER TYPE "GatewayChangeEventKind" ADD VALUE 'CACHE_RULE_DELETED';

ALTER TYPE "GatewayAuditAction" ADD VALUE 'CACHE_RULE_CREATED';
ALTER TYPE "GatewayAuditAction" ADD VALUE 'CACHE_RULE_UPDATED';
ALTER TYPE "GatewayAuditAction" ADD VALUE 'CACHE_RULE_DELETED';

-- Table --------------------------------------------------------------------
CREATE TABLE "GatewayCacheRule" (
    "id"             TEXT                    NOT NULL,
    "organizationId" TEXT                    NOT NULL,
    "name"           TEXT                    NOT NULL,
    "description"    TEXT,
    "priority"       INTEGER                 NOT NULL DEFAULT 100,
    "enabled"        BOOLEAN                 NOT NULL DEFAULT true,
    "matchers"       JSONB                   NOT NULL,
    "action"         JSONB                   NOT NULL,
    "modeEnum"       "GatewayCacheRuleMode"  NOT NULL,
    "archivedAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById"    TEXT                    NOT NULL,

    CONSTRAINT "GatewayCacheRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GatewayCacheRule_organizationId_archivedAt_priority_idx"
    ON "GatewayCacheRule" ("organizationId", "archivedAt", "priority");

CREATE INDEX "GatewayCacheRule_organizationId_enabled_priority_idx"
    ON "GatewayCacheRule" ("organizationId", "enabled", "priority");

-- Foreign keys intentionally OMITTED.
-- Per project policy, FK constraints on hot-path / org-scoped tables are
-- avoided to keep distribution + sharding flexible. Referential integrity
-- is enforced at the service layer (see GatewayCacheRule service guards
-- against orphan org/createdBy refs at write time).

-- Down migration (manual) --------------------------------------------------
-- To roll back, uncomment + run:
--   DROP TABLE "GatewayCacheRule";
--   DROP TYPE  "GatewayCacheRuleMode";
-- Note: enum ADD VALUE is not reversible in Postgres without rebuilding the
-- enum; the CACHE_RULE_* additions on GatewayChangeEventKind +
-- GatewayAuditAction are safe to leave in place on rollback.
