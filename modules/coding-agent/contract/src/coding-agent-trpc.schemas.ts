/**
 * What the `codingAgents.*` surface is asked, as the browser sends it. Separate
 * from the application's own inputs: a screen sends a window it may leave open
 * at either end, and the transport closes it against the clock.
 */
import { z } from "zod";

/** Every procedure on this surface is asked about one project. */
export const codingAgentTrpcProjectScopeSchema = z.object({ projectId: z.string() });

/** One trace; `occurredAtMs` is the caller's hint for which partition holds it. */
export const codingAgentTrpcTraceScopeSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
  occurredAtMs: z.number().int().optional(),
});

/** Window bounds in epoch ms; an open end becomes the trailing thirty days. */
export const codingAgentTrpcUsageTotalsInputSchema = z.object({
  projectId: z.string(),
  fromMs: z.number().int().optional(),
  toMs: z.number().int().optional(),
});

export const codingAgentTrpcRecentSessionsInputSchema = z.object({
  projectId: z.string(),
  fromMs: z.number().int().optional(),
  toMs: z.number().int().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const codingAgentTrpcPullRequestDetailInputSchema = z.object({
  projectId: z.string(),
  repositoryHost: z.string(),
  repositoryFullName: z.string(),
  prNumber: z.number().int().positive(),
});
