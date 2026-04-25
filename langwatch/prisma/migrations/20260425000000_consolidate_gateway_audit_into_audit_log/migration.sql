-- Consolidate GatewayAuditLog into AuditLog
--
-- The AI gateway shipped with its own GatewayAuditLog table + GatewayAuditAction enum.
-- That was an information-architecture mistake — governance events should live in one
-- place. Per rchaves: no beta users yet, no records to preserve, drop freely.
--
-- Forward direction:
--   1. Extend AuditLog with the gateway-shape columns (targetKind/targetId/before/after).
--   2. Add indexes mirroring the gateway table's read patterns.
--   3. Drop GatewayAuditLog table + GatewayAuditAction enum.
--
-- After this migration the gateway services (virtualKey/budget/providerCredential/
-- cacheRule) write to AuditLog directly via the same `GatewayAuditLogRepository`
-- TypeScript class (preserved as a thin shape adapter — see
-- langwatch/src/server/gateway/auditLog.repository.ts).

-- 1. Extend AuditLog with governance fields ---------------------------------

ALTER TABLE "AuditLog"
    ADD COLUMN "targetKind" TEXT,
    ADD COLUMN "targetId"   TEXT,
    ADD COLUMN "before"     JSONB,
    ADD COLUMN "after"      JSONB;

-- 2. Indexes mirroring the dropped GatewayAuditLog read patterns -----------

CREATE INDEX "AuditLog_organizationId_createdAt_idx"
    ON "AuditLog" ("organizationId", "createdAt" DESC);

CREATE INDEX "AuditLog_targetKind_targetId_idx"
    ON "AuditLog" ("targetKind", "targetId");

-- 3. Drop the gateway-only audit table + enum ------------------------------

DROP TABLE IF EXISTS "GatewayAuditLog";
DROP TYPE  IF EXISTS "GatewayAuditAction";
