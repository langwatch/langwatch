import type { Named } from "@langwatch/module";
/**
 * What the `codingAgents.*` surface is asked, as the browser sends it. Separate
 * from the application's own inputs: a screen sends a window it may leave open
 * at either end, and the transport closes it against the clock.
 */
import { z } from "zod";

/** Every procedure on this surface is asked about one project. */
const codingAgentTrpcProjectScopeSchemaDefinition = z.object({ projectId: z.string() });
export interface CodingAgentTrpcProjectScopeSchema extends Named<
  typeof codingAgentTrpcProjectScopeSchemaDefinition
> {}
export const codingAgentTrpcProjectScopeSchema: CodingAgentTrpcProjectScopeSchema =
  codingAgentTrpcProjectScopeSchemaDefinition;

/** One trace; `occurredAtMs` is the caller's hint for which partition holds it. */
const codingAgentTrpcTraceScopeSchemaDefinition = z.object({
  projectId: z.string(),
  traceId: z.string(),
  occurredAtMs: z.number().int().optional(),
});
export interface CodingAgentTrpcTraceScopeSchema extends Named<
  typeof codingAgentTrpcTraceScopeSchemaDefinition
> {}
export const codingAgentTrpcTraceScopeSchema: CodingAgentTrpcTraceScopeSchema =
  codingAgentTrpcTraceScopeSchemaDefinition;

/** Window bounds in epoch ms; an open end becomes the trailing thirty days. */
const codingAgentTrpcUsageTotalsInputSchemaDefinition = z.object({
  projectId: z.string(),
  fromMs: z.number().int().optional(),
  toMs: z.number().int().optional(),
});
export interface CodingAgentTrpcUsageTotalsInputSchema extends Named<
  typeof codingAgentTrpcUsageTotalsInputSchemaDefinition
> {}
export const codingAgentTrpcUsageTotalsInputSchema: CodingAgentTrpcUsageTotalsInputSchema =
  codingAgentTrpcUsageTotalsInputSchemaDefinition;

const codingAgentTrpcRecentSessionsInputSchemaDefinition = z.object({
  projectId: z.string(),
  fromMs: z.number().int().optional(),
  toMs: z.number().int().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export interface CodingAgentTrpcRecentSessionsInputSchema extends Named<
  typeof codingAgentTrpcRecentSessionsInputSchemaDefinition
> {}
export const codingAgentTrpcRecentSessionsInputSchema: CodingAgentTrpcRecentSessionsInputSchema =
  codingAgentTrpcRecentSessionsInputSchemaDefinition;

const codingAgentTrpcPullRequestDetailInputSchemaDefinition = z.object({
  projectId: z.string(),
  repositoryHost: z.string(),
  repositoryFullName: z.string(),
  prNumber: z.number().int().positive(),
});
export interface CodingAgentTrpcPullRequestDetailInputSchema extends Named<
  typeof codingAgentTrpcPullRequestDetailInputSchemaDefinition
> {}
export const codingAgentTrpcPullRequestDetailInputSchema: CodingAgentTrpcPullRequestDetailInputSchema =
  codingAgentTrpcPullRequestDetailInputSchemaDefinition;
