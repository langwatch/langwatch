-- IRREVERSIBLE: adds the OrganizationSeatLease table.
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- One lease per organization while a seat-taking write runs (modules/organization/specs/seat-requests.feature).
-- The table is new, so nothing here locks a table the serving release writes.
CREATE TABLE IF NOT EXISTS "OrganizationSeatLease" (
    "organizationId" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationSeatLease_pkey" PRIMARY KEY ("organizationId")
);
