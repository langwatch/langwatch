-- AiToolEntry: org-scoped catalog of AI tools surfaced on the personal
-- home portal (/me) and managed by org admins at /settings/governance/
-- tool-catalog.
--
-- See:
--   specs/ai-governance/personal-portal/tool-catalog-rbac.feature
--   specs/ai-governance/personal-portal/tool-catalog-scoping.feature
--   specs/ai-governance/personal-portal/tool-catalog-vk-bridge.feature
--
-- Org-scoped (no projectId — the portal lives at the org tier; team
-- entries override org-defaults at read-time via matching `slug`).
-- Three first-class tile types via `type` discriminator:
--   - "coding_assistant" — click expands to setup helper (e.g. `langwatch claude`)
--   - "model_provider"   — click expands to inline personal-VK creation
--   - "external_tool"    — click expands to admin-attached markdown + link
-- Each type's per-tile fields live in the `config` JSONB column,
-- validated at the service layer via a zod discriminated union.

CREATE TABLE "AiToolEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "iconKey" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "AiToolEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AiToolEntry"
    ADD CONSTRAINT "AiToolEntry_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AiToolEntry_organizationId_scope_scopeId_idx"
    ON "AiToolEntry" ("organizationId", "scope", "scopeId");

CREATE INDEX "AiToolEntry_organizationId_enabled_archivedAt_idx"
    ON "AiToolEntry" ("organizationId", "enabled", "archivedAt");

CREATE INDEX "AiToolEntry_organizationId_type_idx"
    ON "AiToolEntry" ("organizationId", "type");

-- To roll back, uncomment and run manually (deployed migrations are
-- immutable history; new migrations should be created instead).
--
-- DROP TABLE "AiToolEntry";
