-- IRREVERSIBLE: this migration only creates the LicenseRenewalClaim table.
-- Dropping a table is an operator step confirmed in Ops, never a migration.
CREATE TABLE IF NOT EXISTS "LicenseRenewalClaim" (
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "claimToken" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL,
    "issuedLicense" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "licenseId" TEXT,

    CONSTRAINT "LicenseRenewalClaim_pkey" PRIMARY KEY ("stripeInvoiceId")
);
