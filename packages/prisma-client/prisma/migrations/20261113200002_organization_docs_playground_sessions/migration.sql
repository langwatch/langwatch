-- IRREVERSIBLE: adds a column with a constant default to "Organization".
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- Whether members may connect the docs playground with a docs session key (ADR-185, amendment of
-- 2026-11-13; modules/api-key/specs/docs-session-keys.feature). On for every organization.
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "docsPlaygroundSessionsEnabled" BOOLEAN NOT NULL DEFAULT true;
