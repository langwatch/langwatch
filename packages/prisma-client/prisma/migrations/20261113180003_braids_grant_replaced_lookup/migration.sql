-- ADR-201 §2: a braid a change replaced never reads again, even once its replacement is removed, so
-- the minter and the braid lists ask which of their grants any row, live or revoked, names in
-- "replacesGrantId". Partial on the column being set: only braid changes carry it, so the index
-- stays a handful of rows beside every share link and binding. Prisma cannot declare a partial
-- index, so schema.prisma names it in a comment instead.
--
-- ops pre-build: a deployment with real traffic can build it ahead of the release, outside Prisma's
-- transaction, where CONCURRENTLY can run:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Grant_organizationId_replacesGrantId_idx"
--     ON "Grant" ("organizationId", "replacesGrantId") WHERE "replacesGrantId" IS NOT NULL;
-- and this statement then becomes a no-op. A failed concurrent build leaves an invalid index under
-- this name that IF NOT EXISTS skips: check pg_index.indisvalid for it and
-- DROP INDEX CONCURRENTLY before retrying.
--
-- LOCKING NOTE: left alone, the plain build takes a SHARE lock on "Grant" while it scans the table;
-- reads keep working and grant writes wait for it.
CREATE INDEX IF NOT EXISTS "Grant_organizationId_replacesGrantId_idx"
  ON "Grant" ("organizationId", "replacesGrantId") WHERE "replacesGrantId" IS NOT NULL;

-- Down (manual rollback): the index holds no row data of its own.
-- DROP INDEX CONCURRENTLY IF EXISTS "Grant_organizationId_replacesGrantId_idx";
