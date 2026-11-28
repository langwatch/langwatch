-- A role change waiting on a seat payment applies only while the member's role version holds.
ALTER TABLE "OrganizationUser" ADD COLUMN IF NOT EXISTS "roleVersion" INTEGER NOT NULL DEFAULT 0;
