-- Backs the sign-on gate's case-insensitive address reads on "Identifier"
-- (lower("value") = lower($1)). Prisma's insensitive `equals` compiled to ILIKE, which
-- the plain "Identifier_value_idx" cannot serve, so each read walked the table.
-- Not declarable in schema.prisma (no expression indexes), noted on Identifier.value instead.
--
-- ops pre-build: on any install with real traffic, run this ahead of the release, outside
-- a transaction, so the build never blocks writes to "Identifier":
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Identifier_value_lower_idx" ON "Identifier" (lower("value"));
-- The statement below then finds it built and does nothing. A failed concurrent build
-- leaves an invalid index under this name that IF NOT EXISTS skips; check
--   SELECT indisvalid FROM pg_index WHERE indexrelid = '"Identifier_value_lower_idx"'::regclass;
-- and DROP INDEX CONCURRENTLY IF EXISTS "Identifier_value_lower_idx" before retrying.
--
-- Left to this statement, the build holds a SHARE lock on "Identifier" while it runs: reads
-- go on, identity projection writes wait. Seconds on a million rows; the pre-build above is
-- the production path.
CREATE INDEX IF NOT EXISTS "Identifier_value_lower_idx" ON "Identifier" (lower("value"));

-- Down (manual rollback; uncomment and run). The index holds no data:
-- DROP INDEX CONCURRENTLY IF EXISTS "Identifier_value_lower_idx";
