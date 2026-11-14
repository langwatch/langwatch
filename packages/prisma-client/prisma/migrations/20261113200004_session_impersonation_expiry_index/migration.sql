-- The impersonation expiry sweep reads lapsed windows by "impersonationExpiresAt"; only the
-- few sessions under an impersonation carry one, so the index holds only those rows.
--
-- ops pre-build: LangWatch Cloud's operator builds it ahead of the release, outside Prisma's
-- transaction, where CONCURRENTLY can run, before this deploys:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Session_impersonationExpiresAt_idx"
--     ON "Session" ("impersonationExpiresAt") WHERE "impersonationExpiresAt" IS NOT NULL;
-- and this statement then becomes a no-op. A self-hosted deployment with real traffic does the
-- same. A failed concurrent build leaves an invalid index under this name that IF NOT EXISTS
-- skips: check it with
--   SELECT indisvalid FROM pg_index WHERE indexrelid =
--     '"Session_impersonationExpiresAt_idx"'::regclass;
-- and DROP INDEX CONCURRENTLY before retrying.
--
-- LOCKING NOTE: left alone, the plain build takes a SHARE lock on "Session" while it scans the
-- table; reads keep working and session writes (sign-ins, sign-outs, refreshes) wait for it.
CREATE INDEX IF NOT EXISTS "Session_impersonationExpiresAt_idx"
  ON "Session" ("impersonationExpiresAt")
  WHERE "impersonationExpiresAt" IS NOT NULL;

-- Down (manual rollback; Prisma runs no down step, so uncomment and run outside a transaction):
-- DROP INDEX CONCURRENTLY IF EXISTS "Session_impersonationExpiresAt_idx";
