import type { Named } from "@langwatch/module";
import { z } from "zod";

import { agentResponseSchema } from "./agent-rest.schemas.ts";
import { agentSchema, agentViewSchema, agentWithFieldsSchema } from "./agent.ts";
import { agentTypeSchema } from "./config/index.ts";

const agentPaginationSchemaDefinition = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export interface AgentPaginationSchema extends Named<typeof agentPaginationSchemaDefinition> {}
export const agentPaginationSchema: AgentPaginationSchema = agentPaginationSchemaDefinition;

const agentPageSchemaDefinition = z.object({
  data: z.array(agentSchema),
  pagination: agentPaginationSchema,
});
export interface AgentPageSchema extends Named<typeof agentPageSchemaDefinition> {}
export const agentPageSchema: AgentPageSchema = agentPageSchemaDefinition;

const agentCopySchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  fullPath: z.string(),
});
export interface AgentCopySchema extends Named<typeof agentCopySchemaDefinition> {}
export const agentCopySchema: AgentCopySchema = agentCopySchemaDefinition;

const agentHistoryEntrySchemaDefinition = z.object({
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
export interface AgentHistoryEntrySchema extends Named<typeof agentHistoryEntrySchemaDefinition> {}
export const agentHistoryEntrySchema: AgentHistoryEntrySchema = agentHistoryEntrySchemaDefinition;

const relatedAgentEntitiesSchemaDefinition = z.object({
  workflow: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export interface RelatedAgentEntitiesSchema extends Named<
  typeof relatedAgentEntitiesSchemaDefinition
> {}
export const relatedAgentEntitiesSchema: RelatedAgentEntitiesSchema =
  relatedAgentEntitiesSchemaDefinition;

const agentReferenceStateSchemaDefinition = z.object({
  id: z.string(),
  archivedAt: z.date().nullable(),
  /** Present so suite runs can identify connected agents and apply ADR-128. */
  type: agentTypeSchema.optional(),
  name: z.string().optional(),
  ownerUserId: z.string().nullable().optional(),
  lastSeenAt: z.date().nullable().optional(),
});
export interface AgentReferenceStateSchema extends Named<
  typeof agentReferenceStateSchemaDefinition
> {}
export const agentReferenceStateSchema: AgentReferenceStateSchema =
  agentReferenceStateSchemaDefinition;

const agentNameSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
});
export interface AgentNameSchema extends Named<typeof agentNameSchemaDefinition> {}
export const agentNameSchema: AgentNameSchema = agentNameSchemaDefinition;

export const getAgentResultSchema = agentWithFieldsSchema;

const getAgentQuerySchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
});
export interface GetAgentQuerySchema extends Named<typeof getAgentQuerySchemaDefinition> {}
export const getAgentQuerySchema: GetAgentQuerySchema = getAgentQuerySchemaDefinition;

const listAgentsQuerySchemaDefinition = z.object({
  projectId: z.string(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(1000).default(50),
});
export interface ListAgentsQuerySchema extends Named<typeof listAgentsQuerySchemaDefinition> {}
export const listAgentsQuerySchema: ListAgentsQuerySchema = listAgentsQuerySchemaDefinition;

const agentIdPathSchemaDefinition = z.object({ id: z.string().min(1) });
export interface AgentIdPathSchema extends Named<typeof agentIdPathSchemaDefinition> {}
export const agentIdPathSchema: AgentIdPathSchema = agentIdPathSchemaDefinition;

const agentViewWithPlatformUrlSchemaDefinition = z.intersection(
  agentViewSchema,
  z.object({ platformUrl: z.string().url() }),
);
export interface AgentViewWithPlatformUrlSchema extends Named<
  typeof agentViewWithPlatformUrlSchemaDefinition
> {}
export const agentViewWithPlatformUrlSchema: AgentViewWithPlatformUrlSchema =
  agentViewWithPlatformUrlSchemaDefinition;

const agentListViewSchemaDefinition = z.object({
  data: z.array(agentViewWithPlatformUrlSchema),
  pagination: agentPaginationSchema,
});
export interface AgentListViewSchema extends Named<typeof agentListViewSchemaDefinition> {}
export const agentListViewSchema: AgentListViewSchema = agentListViewSchemaDefinition;

const archivedAgentViewSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["signature", "code", "workflow", "http", "connected", "voice"]),
  archivedAt: z.date(),
});
export interface ArchivedAgentViewSchema extends Named<typeof archivedAgentViewSchemaDefinition> {}
export const archivedAgentViewSchema: ArchivedAgentViewSchema = archivedAgentViewSchemaDefinition;

export type AgentPage = z.infer<typeof agentPageSchema>;
export type AgentCopy = z.infer<typeof agentCopySchema>;
export type AgentHistoryEntry = z.infer<typeof agentHistoryEntrySchema>;
export type RelatedAgentEntities = z.infer<typeof relatedAgentEntitiesSchema>;
export type AgentReferenceState = z.infer<typeof agentReferenceStateSchema>;
export type AgentName = z.infer<typeof agentNameSchema>;
export type GetAgentResult = z.infer<typeof getAgentResultSchema>;
export type GetAgentInput = z.infer<typeof getAgentQuerySchema>;
export type ListAgentsInput = z.infer<typeof listAgentsQuerySchema>;

export type AgentProjectInput = { projectId: string };
export type AgentReferenceInput = { agentId: string; projectId: string };
export type AgentIdsInput = { ids: string[]; projectId: string };
export type AgentCopiesInput = { sourceAgentId: string; allowedProjectIds?: string[] };
export type PushAgentCopiesInput = {
  sourceAgentId: string;
  sourceProjectId: string;
  copyIds?: string[];
};
export type ConnectedAgentsInput = { projectId: string; name: string };
export type ConnectedAgentsEnvironmentInput = ConnectedAgentsInput & { environment: string };

/** One agent as the legacy tRPC reads render it, copy count included. */
const agentOverviewSchemaDefinition = z.intersection(
  agentWithFieldsSchema,
  agentResponseSchema.omit({
    id: true,
    name: true,
    type: true,
    config: true,
    createdAt: true,
    updatedAt: true,
    platformUrl: true,
  }),
);
export interface AgentOverviewSchema extends Named<typeof agentOverviewSchemaDefinition> {}
export const agentOverviewSchema: AgentOverviewSchema = agentOverviewSchemaDefinition;
export type AgentOverview = z.infer<typeof agentOverviewSchema>;
const agentOverviewPageSchemaDefinition = z.object({
  data: agentOverviewSchema.array(),
  pagination: agentPaginationSchema,
});
export interface AgentOverviewPageSchema extends Named<typeof agentOverviewPageSchemaDefinition> {}
export const agentOverviewPageSchema: AgentOverviewPageSchema = agentOverviewPageSchemaDefinition;
export type AgentOverviewPage = z.infer<typeof agentOverviewPageSchema>;

const agentWithLegacyCopyCountSchemaDefinition = z.intersection(
  agentOverviewSchema,
  z.object({ _count: z.object({ copiedAgents: z.number() }) }),
);
export interface AgentWithLegacyCopyCountSchema extends Named<
  typeof agentWithLegacyCopyCountSchemaDefinition
> {}
export const agentWithLegacyCopyCountSchema: AgentWithLegacyCopyCountSchema =
  agentWithLegacyCopyCountSchemaDefinition;

/** What a cascade archive took with it. */
const agentCascadeArchiveSchemaDefinition = z.object({
  agent: agentSchema,
  archivedWorkflow: z.object({ id: z.string() }).nullable(),
});
export interface AgentCascadeArchiveSchema extends Named<
  typeof agentCascadeArchiveSchemaDefinition
> {}
export const agentCascadeArchiveSchema: AgentCascadeArchiveSchema =
  agentCascadeArchiveSchemaDefinition;

/** The agent a copy created, as the copy answers. */
const agentCopyCreatedSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  copiedFromAgentId: z.string(),
});
export interface AgentCopyCreatedSchema extends Named<typeof agentCopyCreatedSchemaDefinition> {}
export const agentCopyCreatedSchema: AgentCopyCreatedSchema = agentCopyCreatedSchemaDefinition;

/** How far a push to the replicas reached. */
const agentPushToCopiesSchemaDefinition = z.object({
  pushedTo: z.number(),
  selectedCopies: z.number(),
});
export interface AgentPushToCopiesSchema extends Named<typeof agentPushToCopiesSchemaDefinition> {}
export const agentPushToCopiesSchema: AgentPushToCopiesSchema = agentPushToCopiesSchemaDefinition;

/** A copy pulled back into line with the agent it came from. */
const agentSyncFromSourceSchemaDefinition = z.object({ ok: z.literal(true) });
export interface AgentSyncFromSourceSchema extends Named<
  typeof agentSyncFromSourceSchemaDefinition
> {}
export const agentSyncFromSourceSchema: AgentSyncFromSourceSchema =
  agentSyncFromSourceSchemaDefinition;
export type AgentCascadeArchive = z.infer<typeof agentCascadeArchiveSchema>;
export type AgentCopyCreated = z.infer<typeof agentCopyCreatedSchema>;
export type AgentPushToCopies = z.infer<typeof agentPushToCopiesSchema>;
export type AgentSyncFromSource = z.infer<typeof agentSyncFromSourceSchema>;

/**
 * What a test turn answered: the adapter's output, how long it took, and the
 * connected instance that served it, when there was one.
 */
const agentTestTurnResultSchemaDefinition = z.object({
  output: z.unknown(),
  durationMs: z.number(),
  instance: z.object({ hostname: z.string(), label: z.string().nullable() }).nullable(),
});
export interface AgentTestTurnResultSchema extends Named<
  typeof agentTestTurnResultSchemaDefinition
> {}
export const agentTestTurnResultSchema: AgentTestTurnResultSchema =
  agentTestTurnResultSchemaDefinition;

/** The ids a scheduled test run answers with. */
const agentTestRunResultSchemaDefinition = z.object({
  scenarioRunId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
});
export interface AgentTestRunResultSchema extends Named<
  typeof agentTestRunResultSchemaDefinition
> {}
export const agentTestRunResultSchema: AgentTestRunResultSchema =
  agentTestRunResultSchemaDefinition;
export type AgentTestTurnResult = z.infer<typeof agentTestTurnResultSchema>;
export type AgentTestRunResult = z.infer<typeof agentTestRunResultSchema>;

/** What the agent test panel renders for one HTTP run. */
const httpProxyResultSchemaDefinition = z.object({
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
export interface HttpProxyResultSchema extends Named<typeof httpProxyResultSchemaDefinition> {}
export const httpProxyResultSchema: HttpProxyResultSchema = httpProxyResultSchemaDefinition;
export type HttpProxyResult = z.infer<typeof httpProxyResultSchema>;
