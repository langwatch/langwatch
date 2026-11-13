-- The impersonation expiry sweep reads lapsed windows by "impersonationExpiresAt"; only the
-- few sessions under an impersonation carry one, so the index holds only those rows.
-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_impersonationExpiresAt_idx" ON "Session" ("impersonationExpiresAt") WHERE "impersonationExpiresAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Session_impersonationExpiresAt_idx"
  ON "Session" ("impersonationExpiresAt")
  WHERE "impersonationExpiresAt" IS NOT NULL;

-- Down (manual rollback; Prisma runs no down step, so uncomment and run outside a transaction):
-- DROP INDEX CONCURRENTLY IF EXISTS "Session_impersonationExpiresAt_idx";
