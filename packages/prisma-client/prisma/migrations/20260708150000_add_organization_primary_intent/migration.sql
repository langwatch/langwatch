-- ADR-038: organization signup intent. Nullable, no default, no backfill —
-- NULL means "intent unset" and the home resolver keeps legacy behavior.
CREATE TYPE "OrganizationIntent" AS ENUM ('AGENT_GOVERNANCE', 'LLM_OPS');

ALTER TABLE "Organization" ADD COLUMN "primaryIntent" "OrganizationIntent";
