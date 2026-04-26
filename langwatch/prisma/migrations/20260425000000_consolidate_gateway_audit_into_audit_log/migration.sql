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
--
-- userId is dropped to nullable so system-actor writes (background jobs,
-- migrations, internal cron) can record audit rows without a user. Spec:
-- specs/audit-log/audit-log.feature ("userId is changed to String? (nullable)
-- so system actions can write rows without a user"). Live consumers always
-- supply userId today; this is forward-defense for the system-actor path.
-- DROP NOT NULL is a fast metadata-only operation on PG — no rewrite.

ALTER TABLE "AuditLog"
    ADD COLUMN "targetKind" TEXT,
    ADD COLUMN "targetId"   TEXT,
    ADD COLUMN "before"     JSONB,
    ADD COLUMN "after"      JSONB,
    ALTER COLUMN "userId" DROP NOT NULL;

-- 2. Indexes mirroring the dropped GatewayAuditLog read patterns -----------

CREATE INDEX "AuditLog_organizationId_createdAt_idx"
    ON "AuditLog" ("organizationId", "createdAt" DESC);

CREATE INDEX "AuditLog_targetKind_targetId_idx"
    ON "AuditLog" ("targetKind", "targetId");

-- 3. Drop the gateway-only audit table + enum ------------------------------

DROP TABLE IF EXISTS "GatewayAuditLog";
DROP TYPE  IF EXISTS "GatewayAuditAction";
