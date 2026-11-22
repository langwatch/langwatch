-- IRREVERSIBLE: this migration only adds a nullable column to NurturingOrganization.
-- Dropping a column is an operator step confirmed in Ops, never a migration.
ALTER TABLE "NurturingOrganization" ADD COLUMN IF NOT EXISTS "lastTraceAt" TIMESTAMP(3);
