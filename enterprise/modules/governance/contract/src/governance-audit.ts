import { z } from "zod";

export const GOVERNANCE_CALL_SURFACES = ["trpc", "hono", "cli", "mcp"] as const;
export const governanceCallSurfaceSchema = z.enum(GOVERNANCE_CALL_SURFACES);
export type GovernanceCallSurface = z.infer<typeof governanceCallSurfaceSchema>;
export const DEFAULT_GOVERNANCE_SURFACE: GovernanceCallSurface = "trpc";
