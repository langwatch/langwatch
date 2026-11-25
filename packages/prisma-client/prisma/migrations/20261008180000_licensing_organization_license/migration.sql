-- Licensing's own licence table (round 37 D6): the key an organization activated and its
-- dates. A new table only; the background step licensing:copy-organization-licenses fills it
-- from the Organization columns, which stay in place. Rollback is dropping it.

-- CreateTable
CREATE TABLE IF NOT EXISTS "OrganizationLicense" (
    "organizationId" TEXT NOT NULL,
    "licenseKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationLicense_pkey" PRIMARY KEY ("organizationId")
);
