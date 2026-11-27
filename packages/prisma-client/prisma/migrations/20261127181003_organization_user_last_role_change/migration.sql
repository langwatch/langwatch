-- The paid role change the newest role write applied, so a retry recognises its own write.
ALTER TABLE "OrganizationUser" ADD COLUMN IF NOT EXISTS "lastRoleChangeId" TEXT;
