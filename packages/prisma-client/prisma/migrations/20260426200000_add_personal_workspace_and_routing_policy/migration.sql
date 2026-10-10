-- Phase 1A — Personal Workspace + Routing Policy.
--
-- Adds the schema scaffolding for governance-platform direction 1
-- (personal IDE keys flow). Three discrete additions:
--
--   1. Team.isPersonal + ownerUserId — auto-created per (user, org).
--      Personal teams contain exactly one Project (the user's Personal
--      Workspace) and a small number of personal VirtualKeys.
--
--   2. Project.isPersonal + ownerUserId — denormalised mirror of the
--      parent Team's flag for fast lookup at trace-ingest time.
--      `principalUserId` on the trace row points at the human; this
--      flag answers "is this a personal-tenant project" without a join.
--
--   3. RoutingPolicy table — admin-owned routing template that VKs can
--      reference instead of embedding their own fallback chain. Lets a
--      personal VK be issued by a click without requiring the user to
--      pick provider order; the org's `developer-default` policy
--      provides the chain.
--
-- Schema uses `relationMode = "prisma"` (FK enforcement at app layer);
-- no SQL FOREIGN KEY constraints are emitted.
--
-- Deliberately deferred from this migration (per gateway.md ramp):
--   - VirtualKey.ownerType / ownerId polymorphism — personal VKs are
--     identified via Project.isPersonal on their parent project; no
--     branching required in the gateway code path.
--   - trace_summaries.OrganizationId column — slows fan-out queries
--     today but does not block any feature; add only when a dashboard
--     proves it necessary.
--   - trace_summaries.UserId column — extracted from canonical
--     attributes today; no production query needs it indexed yet.
--
-- All adds are nullable / have defaults so the migration is safe on a
-- live table.

-- ---------------------------------------------------------------------------
-- 1. Team.isPersonal + ownerUserId
-- ---------------------------------------------------------------------------
ALTER TABLE "Team"
    ADD COLUMN "isPersonal"  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ownerUserId" VARCHAR(255);

-- Personal teams are looked up via (organizationId, ownerUserId). One per
-- (org, user) pair — enforced via partial unique index so legacy shared
-- teams remain unaffected.
CREATE UNIQUE INDEX "Team_organizationId_ownerUserId_personal_key"
    ON "Team" ("organizationId", "ownerUserId")
    WHERE "isPersonal" = true;

CREATE INDEX "Team_isPersonal_idx" ON "Team" ("isPersonal");

-- ---------------------------------------------------------------------------
-- 2. Project.isPersonal + ownerUserId
-- ---------------------------------------------------------------------------
ALTER TABLE "Project"
    ADD COLUMN "isPersonal"  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "ownerUserId" VARCHAR(255);

CREATE INDEX "Project_isPersonal_idx" ON "Project" ("isPersonal");
CREATE INDEX "Project_ownerUserId_idx" ON "Project" ("ownerUserId");

-- ---------------------------------------------------------------------------
-- 3. RoutingPolicy table
-- ---------------------------------------------------------------------------
-- Admin-defined routing template. A VirtualKey can either:
--   (a) reference a RoutingPolicy via `routingPolicyId` — gateway pulls
--       provider chain + model allowlist from the policy. Used for
--       personal keys (issued by a click), evaluator system keys, and
--       any VK where the admin wants centralised governance.
--   (b) leave `routingPolicyId` null and embed its chain via
--       `VirtualKeyProviderCredential` rows — legacy behaviour for
--       service VKs that need bespoke fallback ordering.
--
-- Both paths coexist; gateway dispatcher checks `routingPolicyId` first,
-- falls through to the legacy join table when null.
CREATE TABLE "RoutingPolicy" (
    "id"                    TEXT NOT NULL,
    "organizationId"        TEXT NOT NULL,
    "scope"                 TEXT NOT NULL,
    "scopeId"               TEXT NOT NULL,
    "name"                  TEXT NOT NULL,
    "description"           TEXT,
    "providerCredentialIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "modelAllowlist"        JSONB,
    "strategy"              TEXT NOT NULL DEFAULT 'priority',
    "isDefault"             BOOLEAN NOT NULL DEFAULT false,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById"           TEXT,
    "updatedById"           TEXT,

    CONSTRAINT "RoutingPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoutingPolicy_org_scope_scopeId_name_key"
    ON "RoutingPolicy" ("organizationId", "scope", "scopeId", "name");

-- At most one default policy per (organizationId, scope, scopeId).
-- Partial unique allows multiple non-default policies under the same scope.
CREATE UNIQUE INDEX "RoutingPolicy_org_scope_scopeId_default_key"
    ON "RoutingPolicy" ("organizationId", "scope", "scopeId")
    WHERE "isDefault" = true;

CREATE INDEX "RoutingPolicy_organizationId_idx" ON "RoutingPolicy" ("organizationId");
CREATE INDEX "RoutingPolicy_scope_scopeId_idx"  ON "RoutingPolicy" ("scope", "scopeId");

-- ---------------------------------------------------------------------------
-- 4. VirtualKey.routingPolicyId
-- ---------------------------------------------------------------------------
-- Nullable. NULL = use embedded chain via VirtualKeyProviderCredential
-- (legacy behaviour). Set = pull chain + allowlist from RoutingPolicy.
ALTER TABLE "VirtualKey"
    ADD COLUMN "routingPolicyId" TEXT;

CREATE INDEX "VirtualKey_routingPolicyId_idx" ON "VirtualKey" ("routingPolicyId");
