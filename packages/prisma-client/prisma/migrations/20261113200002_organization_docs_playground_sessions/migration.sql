-- IRREVERSIBLE: adds two columns to "Organization", one with a constant default.
-- A rollback leaves it in place; dropping it is an operator step confirmed in Ops.
-- Whether members may connect the docs playground with a docs session key (ADR-185, amendment of
-- 2026-11-13; modules/api-key/specs/docs-session-keys.feature), on for every organization; and
-- when it was last turned off: keys minted at or before it never authenticate again.
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "docsPlaygroundSessionsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "docsPlaygroundSessionsDisabledAt" TIMESTAMP(3);
