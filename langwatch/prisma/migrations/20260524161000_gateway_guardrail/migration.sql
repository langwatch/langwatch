-- Lift Guardrail config from per-VK config (iter 110:
-- vk.config.guardrails) onto a project-scoped top-level table so a
-- project admin can author once + attach to N VKs by reference.
--
-- Project-scoped only (for now): single non-null projectId column,
-- NO scope join table. Widening later means dropping the column to
-- nullable + adding GatewayGuardrailScope in a separate migration —
-- the current shape enforces the constraint at schema level instead
-- of requiring resolver-side validation.
--
-- VKs opt in via vk.config.guardrailAttachments[] of
--   { direction, guardrailIds[] }
-- tuples; cross-project attach is rejected at the service layer.
--
-- relationMode="prisma" means no SQL FK constraint is emitted; the
-- referential integrity is enforced at the application layer per
-- convention.
--
-- Forward-only. Down migration would be DROP TABLE
-- "GatewayGuardrail" + DROP TYPE for both enums; commented out per
-- CLAUDE.md convention.

CREATE TYPE "GatewayGuardrailDirection" AS ENUM ('PRE', 'POST', 'STREAM_CHUNK');

CREATE TYPE "GatewayGuardrailFailureMode" AS ENUM ('FAIL_OPEN', 'FAIL_CLOSED');

CREATE TABLE "GatewayGuardrail" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "evaluatorId" TEXT NOT NULL,
  "direction" "GatewayGuardrailDirection" NOT NULL,
  "failureMode" "GatewayGuardrailFailureMode" NOT NULL DEFAULT 'FAIL_CLOSED',
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "updatedById" TEXT,
  CONSTRAINT "GatewayGuardrail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GatewayGuardrail_projectId_idx" ON "GatewayGuardrail"("projectId");
CREATE INDEX "GatewayGuardrail_evaluatorId_idx" ON "GatewayGuardrail"("evaluatorId");
CREATE INDEX "GatewayGuardrail_projectId_archivedAt_idx" ON "GatewayGuardrail"("projectId", "archivedAt");
