/**
 * Mirror of `GovernanceCallSurface` from the langwatch app
 * (ee/governance/services/auditSurface.ts). Kept as a hand-written
 * type alias rather than imported because this package doesn't
 * pull from the langwatch source tree.
 *
 * The SDK only ever sends "cli" — the other values are documented
 * here so the type stays informational + so any future SDK regen
 * targeting governance audit metadata picks up the canonical set.
 *
 * Lives at `internal/` (not `cli/utils/governance/`) because both the
 * credential context and every CLI request built via
 * `createLangWatchApiClient` need it, and neither should pull in the
 * governance-specific module tree to get a header name.
 */
export type GovernanceCallSurface = "trpc" | "hono" | "cli" | "mcp";

export const CLI_SURFACE_HEADER = "X-LangWatch-Surface" as const;
export const CLI_SURFACE_VALUE: GovernanceCallSurface = "cli";
