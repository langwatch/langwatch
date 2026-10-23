-- ADR-185 §2: an organisation's braid setting, one row per organisation, owned by authz. A new,
-- empty table; an organisation with no row has the setting off. Column refs only, no foreign key.
CREATE TABLE IF NOT EXISTS "AuthzOrganizationPolicy" (
    "organizationId" TEXT NOT NULL,
    "braidsOrganizationAdminsOnly" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AuthzOrganizationPolicy_pkey" PRIMARY KEY ("organizationId")
);
