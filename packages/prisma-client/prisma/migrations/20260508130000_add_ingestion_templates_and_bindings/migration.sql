-- IngestionTemplate + UserIngestionBinding: per-user trace-ingest binding
-- model. Templates are admin/platform-curated catalog rows that own the
-- canonical OTTL transform for an upstream tool's span shape; bindings
-- are user-managed installs that issue a server-scoped binding access
-- token (lwub_<base32>) the user pastes into their upstream tool's OTLP
-- exporter Bearer auth.
--
-- See:
--   specs/ai-gateway/governance/ingestion-templates-catalog.feature
--   specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature
--   specs/ai-gateway/governance/personal-project-ingest-via-template.feature
--   specs/ai-gateway/governance/template-cross-bind-guard.feature
--   specs/ai-gateway/governance/template-ottl-principal-guard.feature
--
-- IngestionTemplate.organizationId is nullable: NULL = platform-published
-- default (always-visible across every org); NOT NULL = org-authored
-- (visible only within that org). v1 only ships platform-published rows;
-- the column lands now to avoid a future migration when org-authoring UI
-- arrives.
--
-- UserIngestionBinding.bindingAccessTokenHash is the receiver auth scope
-- (SHA256 hex). Hard-cut rotation v1: rotate replaces the column in-place,
-- no grace window. previousBindingAccessTokenHash + invalidatesAt are NOT
-- shipped v1; defer to a future migration if SOC2 review requests.
--
-- Cross-bind guard is service-layer (structural-impossibility): the
-- bindingService input shape MUST NOT accept personalProjectId. Server
-- resolves via getPersonalProjectForUser(userId) at install time. The
-- column is still indexed to support receiver defense-in-depth re-verify.

-- IngestionTemplate ----------------------------------------------------------

CREATE TABLE "IngestionTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "slug" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "iconAsset" TEXT,
    "credentialSchema" TEXT,
    "ottlRules" TEXT NOT NULL DEFAULT '',
    "platformPublished" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "IngestionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IngestionTemplate_organizationId_slug_key"
    ON "IngestionTemplate" ("organizationId", "slug");

CREATE INDEX "IngestionTemplate_organizationId_archivedAt_idx"
    ON "IngestionTemplate" ("organizationId", "archivedAt");

CREATE INDEX "IngestionTemplate_sourceType_idx"
    ON "IngestionTemplate" ("sourceType");

-- UserIngestionBinding -------------------------------------------------------

CREATE TABLE "UserIngestionBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "personalProjectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bindingAccessTokenHash" TEXT NOT NULL,
    "bindingAccessTokenPrefix" TEXT NOT NULL,
    "encryptedCredential" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIngestionBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIngestionBinding_bindingAccessTokenHash_key"
    ON "UserIngestionBinding" ("bindingAccessTokenHash");

CREATE UNIQUE INDEX "UserIngestionBinding_userId_templateId_key"
    ON "UserIngestionBinding" ("userId", "templateId");

CREATE INDEX "UserIngestionBinding_organizationId_archivedAt_idx"
    ON "UserIngestionBinding" ("organizationId", "archivedAt");

CREATE INDEX "UserIngestionBinding_userId_archivedAt_idx"
    ON "UserIngestionBinding" ("userId", "archivedAt");

CREATE INDEX "UserIngestionBinding_templateId_idx"
    ON "UserIngestionBinding" ("templateId");

CREATE INDEX "UserIngestionBinding_personalProjectId_idx"
    ON "UserIngestionBinding" ("personalProjectId");

-- To roll back, uncomment and run manually (deployed migrations are
-- immutable history; new migrations should be created instead).
--
-- DROP TABLE "UserIngestionBinding";
-- DROP TABLE "IngestionTemplate";
