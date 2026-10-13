-- Licensing's copy of sso's sign-in provider fact (ADR-179); one row, no tenant.
CREATE TABLE IF NOT EXISTS "SignInProviderMount" (
    "id" TEXT NOT NULL DEFAULT 'self',
    "provider" TEXT,
    "mounted" BOOLEAN NOT NULL,
    "lastAppliedEventId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignInProviderMount_pkey" PRIMARY KEY ("id")
);
