-- An organization admin's acceptance of the PII Redaction Model's price: when, and who. Null
-- until then, and nothing fills it: Strict stays on the rule-based detector, unbilled (ADR-201).
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "piiRedactionModelAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "piiRedactionModelAcceptedByUserId" TEXT;
