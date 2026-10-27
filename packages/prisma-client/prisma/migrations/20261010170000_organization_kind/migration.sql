-- An organization is a customer's unless it is the install's hidden system organization
-- (modules/ops/specs/checkup-canary-project.feature).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'customer';
