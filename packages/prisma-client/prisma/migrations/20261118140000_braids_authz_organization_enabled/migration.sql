-- ADR-201 §9 (decided by Alex, 2026-11-18): an organisation turns Braids on in settings. Expand
-- only: a constant default, so every existing organisation reads off and no row is rewritten.
ALTER TABLE "AuthzOrganizationPolicy" ADD COLUMN IF NOT EXISTS "braidsEnabled" BOOLEAN NOT NULL DEFAULT false;
