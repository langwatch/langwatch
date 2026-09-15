/**
 * Database enums restated (cannot import @prisma/client in browser package);
 * keep in sync with schema.prisma.
 */

/** ADR-038 "Primary use": which product the organization came for. */
export type OrganizationIntent = "AGENT_GOVERNANCE" | "LLM_OPS";
