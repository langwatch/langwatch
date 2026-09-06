import { z } from "zod";
import { agentSchema, agentViewSchema, agentWithFieldsSchema } from "./agent";
import { agentTypeSchema } from "./config";

export const agentPaginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const agentPageSchema = z.object({
  data: z.array(agentSchema),
  pagination: agentPaginationSchema,
});

export const agentCopySchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  fullPath: z.string(),
});

export const agentHistoryEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  createdAt: z.date(),
  args: z.unknown(),
  user: z
    .object({
      id: z.string(),
      name: z.string().nullable(),
      email: z.string().nullable(),
    })
    .nullable(),
});

export const relatedAgentEntitiesSchema = z.object({
  workflow: z.object({ id: z.string(), name: z.string() }).nullable(),
});

export const agentReferenceStateSchema = z.object({
  id: z.string(),
  archivedAt: z.date().nullable(),
  /**
   * Present so a suite run can tell a connected agent apart from the other
   * types and treat one unseen too long (ADR-128) as archived, the way
   * `findManyIncludingArchived` reads it on main. Absent from a caller that
   * has no use for it.
   */
  type: agentTypeSchema.optional(),
  name: z.string().optional(),
  ownerUserId: z.string().nullable().optional(),
  lastSeenAt: z.date().nullable().optional(),
});

export const agentNameSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const getAgentResultSchema = agentWithFieldsSchema;

export const getAgentQuerySchema = z.object({
  id: z.string(),
  projectId: z.string(),
});

export const listAgentsQuerySchema = z.object({
  projectId: z.string(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(50),
});

export const agentIdPathSchema = z.object({ id: z.string().min(1) });

export const agentViewWithPlatformUrlSchema = z.intersection(
  agentViewSchema,
  z.object({ platformUrl: z.string().url() }),
);

export const agentListViewSchema = z.object({
  data: z.array(agentViewWithPlatformUrlSchema),
  pagination: agentPaginationSchema,
});

export const archivedAgentViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["signature", "code", "workflow", "http", "connected"]),
  archivedAt: z.date(),
});

export type AgentPage = z.infer<typeof agentPageSchema>;
export type AgentCopy = z.infer<typeof agentCopySchema>;
export type AgentHistoryEntry = z.infer<typeof agentHistoryEntrySchema>;
export type RelatedAgentEntities = z.infer<typeof relatedAgentEntitiesSchema>;
export type AgentReferenceState = z.infer<typeof agentReferenceStateSchema>;
export type AgentName = z.infer<typeof agentNameSchema>;
export type GetAgentResult = z.infer<typeof getAgentResultSchema>;

/** One agent as the legacy tRPC reads render it, copy count included. */
export const agentWithLegacyCopyCountSchema = z.intersection(
  agentWithFieldsSchema,
  z.object({ _count: z.object({ copiedAgents: z.number() }) }),
);

/** What a cascade archive took with it. */
export const agentCascadeArchiveSchema = z.object({
  agent: agentSchema,
  archivedWorkflow: z.object({ id: z.string() }).nullable(),
});

/** The agent a copy created, as the copy answers. */
export const agentCopyCreatedSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  copiedFromAgentId: z.string(),
});

/** How far a push to the replicas reached. */
export const agentPushToCopiesSchema = z.object({
  pushedTo: z.number(),
  selectedCopies: z.number(),
});

/** A copy pulled back into line with the agent it came from. */
export const agentSyncFromSourceSchema = z.object({ ok: z.literal(true) });

/**
 * What a test turn answered: the adapter's output, how long it took, and the
 * connected instance that served it, when there was one.
 */
export const agentTestTurnResultSchema = z.object({
  output: z.unknown(),
  durationMs: z.number(),
  instance: z.object({ hostname: z.string(), label: z.string().nullable() }).nullable(),
});

/** The ids a scheduled test run answers with. */
export const agentTestRunResultSchema = z.object({
  scenarioRunId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
});
export type AgentTestTurnResult = z.infer<typeof agentTestTurnResultSchema>;
export type AgentTestRunResult = z.infer<typeof agentTestRunResultSchema>;

/** What the agent test panel renders for one HTTP run. */
export const httpProxyResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  /** The engine's stable failure code, which the panel presents copy from. */
  errorCode: z.string().optional(),
  response: z.unknown().optional(),
  extractedOutput: z.string().optional(),
  status: z.number().optional(),
  statusText: z.string().optional(),
  duration: z.number().optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  /** The request body the engine sent, after templating. */
  renderedBody: z.string().optional(),
  /** Template variables the body referenced but the test did not supply. */
  warnings: z.array(z.string()).optional(),
});
export type HttpProxyResult = z.infer<typeof httpProxyResultSchema>;
