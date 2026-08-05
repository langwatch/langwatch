-- AlterTable
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "impersonating" JSONB;
