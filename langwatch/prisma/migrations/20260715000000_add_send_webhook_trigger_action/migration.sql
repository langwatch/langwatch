-- IRREVERSIBLE: PostgreSQL enum values cannot be safely removed without
-- recreating the type and migrating dependents.
-- AlterEnum
ALTER TYPE "TriggerAction" ADD VALUE 'SEND_WEBHOOK';
