/**
 * The database enums this family reads, restated.
 *
 * A browser package may not import `@prisma/client` — the generated client
 * pulls a Node runtime in with it — so the members are written out here. They
 * are pinned to `packages/prisma-client/prisma/schema.prisma`: adding a member
 * there without adding it here narrows a form to a value the database no
 * longer only accepts, which the type checker cannot see.
 */

/** ADR-038 "Primary use": which product the organization came for. */
export type OrganizationIntent = "AGENT_GOVERNANCE" | "LLM_OPS";
