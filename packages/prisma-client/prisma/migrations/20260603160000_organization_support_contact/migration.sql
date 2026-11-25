-- Org-configurable contact surfaced in CLI "contact your admin" and the
-- in-app budget-exceeded banner. Free text by design: accepts an email,
-- a URL pointing at an internal ticketing system, or any other
-- instruction. When NULL the resolver falls back to the first ADMIN
-- member's email — the prior implicit behavior, preserved.
ALTER TABLE "Organization" ADD COLUMN "supportContact" TEXT;
