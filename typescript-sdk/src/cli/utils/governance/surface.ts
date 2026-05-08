/**
 * Mirror of `GovernanceCallSurface` from the langwatch app
 * (ee/governance/services/auditSurface.ts). Kept as a hand-written
 * type alias rather than imported because the CLI package doesn't
 * pull from the langwatch source tree.
 *
 * The CLI only ever sends "cli" — the other values are documented
 * here so the type stays informational + so any future SDK regen
 * targeting governance audit metadata picks up the canonical set.
 */
export type GovernanceCallSurface = "trpc" | "hono" | "cli" | "mcp";

export const CLI_SURFACE_HEADER = "X-LangWatch-Surface" as const;
export const CLI_SURFACE_VALUE: GovernanceCallSurface = "cli";
