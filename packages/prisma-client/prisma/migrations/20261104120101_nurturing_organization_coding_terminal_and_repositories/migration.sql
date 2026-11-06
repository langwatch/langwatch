-- IRREVERSIBLE: this migration only adds defaulted columns to NurturingOrganization.
-- Dropping a column is an operator step confirmed in Ops, never a migration.
ALTER TABLE "NurturingOrganization"
  ADD COLUMN IF NOT EXISTS "codingTerminalTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "codingRepositoryKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];
