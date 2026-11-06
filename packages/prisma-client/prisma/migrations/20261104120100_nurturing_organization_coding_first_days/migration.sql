-- IRREVERSIBLE: this migration only adds a defaulted column to NurturingOrganization.
-- Dropping a column is an operator step confirmed in Ops, never a migration.
ALTER TABLE "NurturingOrganization"
  ADD COLUMN IF NOT EXISTS "codingFirstDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
