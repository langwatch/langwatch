-- An organization admin's acceptance of the PII Redaction Model's price: when, and who. Null
-- until then, and nothing fills it: Strict stays on the rule-based detector, unbilled (ADR-201).
-- IRREVERSIBLE: no down step. It adds two nullable columns; rolling the release back leaves them,
-- and every acceptance recorded in them, in place and unread. A migration never drops a column;
-- a drop is an operator step.
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "piiRedactionModelAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "piiRedactionModelAcceptedByUserId" TEXT;
