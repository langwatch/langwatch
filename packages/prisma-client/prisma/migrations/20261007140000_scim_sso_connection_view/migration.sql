-- SCIM's own copy of an organization's SSO connections, owned by scim: a peer fold over
-- identity's connection facts (ARCHITECTURE §9), so SCIM stops asking identity which
-- connections exist. One row per connection; the folded state as JSON beside the
-- columns the reads filter on.
--
-- Expand only: a new table nobody else reads or writes. No foreign key: the rows are
-- rebuilt from identity's event log by a projection replay of the lane
-- `scim_sso_connections.ssoConnections`, which is also how existing connections arrive.
--
-- Spec: enterprise/modules/scim/specs/scim-sso-connection-view.feature
--
-- IRREVERSIBLE: there is no down migration. It reverses by hand:
--
--   DROP TABLE "ScimSsoConnectionView";

CREATE TABLE IF NOT EXISTS "ScimSsoConnectionView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "folded" JSONB NOT NULL,
    "appliedEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectionVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimSsoConnectionView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScimSsoConnectionView_organizationId_createdAt_idx"
    ON "ScimSsoConnectionView"("organizationId", "createdAt");
