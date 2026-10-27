-- ADR-092 delivery-plan PR 3: the resource tier's own columns, the view
-- accounting they need, and the refusal the cutover fold can record.

-- AlterTable
ALTER TABLE "Grant" ADD COLUMN     "resourceKind" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "createdByUserId" TEXT;

-- CreateTable
CREATE TABLE "GrantUsage" (
    "grantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrantUsage_pkey" PRIMARY KEY ("grantId")
);

-- CreateIndex
CREATE INDEX "Grant_projectId_resourceKind_scopeId_idx" ON "Grant"("projectId", "resourceKind", "scopeId");

-- CreateIndex
CREATE INDEX "GrantUsage_organizationId_idx" ON "GrantUsage"("organizationId");

-- CreateIndex
-- The share write path's conditional consume fences on the project as well
-- as the grant and the organization, and the cutover seeds a whole project's
-- budgets in one statement. Without this those reads fall back to the
-- organization index and filter every share link the tenant has.
CREATE INDEX "GrantUsage_projectId_idx" ON "GrantUsage"("projectId");

-- AlterTable
-- Why a cutover_completed fact did not put an organization on the engine.
-- The fold is a pure reducer, so a refusal cannot be logged where it happens;
-- it is state instead, and this is the column an operator reads it from.
ALTER TABLE "AuthzCutoverProjection" ADD COLUMN "completionRefusedReason" TEXT;

-- The resource tier's identity is FOUR columns, not two.
--
-- 20260817160000 tied `token` and `permission` to `scopeType = 'RESOURCE'`,
-- which was the whole of the tier at the time. This migration adds
-- `resourceKind` and `projectId`, and the wire schema now requires both on
-- every resource fact: `scopeId` alone is the shared thing's id, so without
-- them a row cannot say WHAT that id names or WHERE it lives, and the
-- possession read fences on exactly those two. A row holding some of the four
-- is a share credential that matches more than the link it came from, so the
-- check is widened to all-or-nothing across the set.
--
-- Dropped and recreated rather than added alongside: one constraint, one
-- name, one place to read the rule.
ALTER TABLE "Grant" DROP CONSTRAINT "Grant_resource_terms_check";
ALTER TABLE "Grant" ADD CONSTRAINT "Grant_resource_terms_check" CHECK (
    ("scopeType" = 'RESOURCE' AND num_nonnulls("token", "permission", "resourceKind", "projectId") = 4)
    OR ("scopeType" <> 'RESOURCE' AND num_nonnulls("token", "permission", "resourceKind", "projectId") = 0)
);

-- To roll back, uncomment and run manually:
--
-- ALTER TABLE "Grant" DROP CONSTRAINT "Grant_resource_terms_check";
-- ALTER TABLE "Grant" ADD CONSTRAINT "Grant_resource_terms_check" CHECK (
--     ("scopeType" = 'RESOURCE' AND num_nonnulls("token", "permission") = 2)
--     OR ("scopeType" <> 'RESOURCE' AND num_nonnulls("token", "permission") = 0)
-- );
-- ALTER TABLE "AuthzCutoverProjection" DROP COLUMN "completionRefusedReason";
-- DROP INDEX "GrantUsage_projectId_idx";
-- DROP INDEX "GrantUsage_organizationId_idx";
-- DROP INDEX "Grant_projectId_resourceKind_scopeId_idx";
-- DROP TABLE "GrantUsage";           -- destroys every share link's view budget
-- ALTER TABLE "Grant" DROP COLUMN "resourceKind", DROP COLUMN "projectId", DROP COLUMN "createdByUserId";
