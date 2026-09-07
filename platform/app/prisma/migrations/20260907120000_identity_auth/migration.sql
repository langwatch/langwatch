-- Identity authentication core: session principal claims, identifier usage,
-- and audit attribution. All schema changes are additive so existing users
-- remain signed in throughout a rolling deployment.

ALTER TABLE "Session"
  ADD COLUMN "actorUserId" TEXT,
  ADD COLUMN "subjectUserId" TEXT,
  ADD COLUMN "impersonationReason" TEXT,
  ADD COLUMN "impersonationExpiresAt" TIMESTAMP(3);

CREATE INDEX "Session_identifierId_idx" ON "Session"("identifierId");

-- Revoke only legacy impersonation sessions before the new claims become the
-- source of truth. Some developer databases ran an earlier, now-retired
-- migration that already removed the compatibility column, hence the guard.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Session' AND column_name = 'impersonating'
  ) THEN
    DELETE FROM "Session" WHERE "impersonating" IS NOT NULL;
  END IF;
END $$;

-- Keep the legacy column for one release: old pods still select it during a
-- rolling deployment. This is also an idempotent repair for developer
-- databases that ran the retired early-contract migration.
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "impersonating" JSONB;

ALTER TABLE "Identifier" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

ALTER TABLE "AuditLog" ADD COLUMN "actorUserId" TEXT;

CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
