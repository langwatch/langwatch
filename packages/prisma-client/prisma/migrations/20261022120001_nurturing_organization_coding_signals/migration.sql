-- IRREVERSIBLE: this migration only adds nullable or defaulted columns to NurturingOrganization.
-- Dropping a column is an operator step confirmed in Ops, never a migration.
ALTER TABLE "NurturingOrganization"
  ADD COLUMN IF NOT EXISTS "codingFirstSessionAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "codingAgentTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "codingActiveDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "codingLastActiveDay" TEXT;
