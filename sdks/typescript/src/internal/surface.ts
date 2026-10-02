/** Hand-written mirror of GovernanceCallSurface from the app (CLI doesn't
 * import from the source tree). CLI sends only "cli"; others documented for
 * future SDK regen. */
export type GovernanceCallSurface = "trpc" | "hono" | "cli" | "mcp";

export const CLI_SURFACE_HEADER = "X-LangWatch-Surface" as const;
export const CLI_SURFACE_VALUE: GovernanceCallSurface = "cli";
