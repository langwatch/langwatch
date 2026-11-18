-- ADR-201 §9 (decided by Alex, 2026-11-18): an organisation turns Braids on in settings. Expand
-- only: a constant default, so every existing organisation reads off and no row is rewritten.
-- IRREVERSIBLE: no down step. A rollback leaves the column, which the previous release ignores;
-- dropping it loses each organisation's choice, and a drop is an operator step, never automatic.
ALTER TABLE "AuthzOrganizationPolicy" ADD COLUMN IF NOT EXISTS "braidsEnabled" BOOLEAN NOT NULL DEFAULT false;
