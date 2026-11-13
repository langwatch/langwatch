// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The agent registry's one document shape: stored, served over REST, carried in every change
 * event and webhook body, and inlined as the ARD entry's agent card. snake_case on purpose: it is
 * a wire document first. Spec: enterprise/modules/governance/specs/agent-registry.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

export const AGENT_REGISTRY_SOURCES = [
  "langwatch",
  "databricks",
  "copilot_studio",
  "traffic",
] as const;
export type AgentRegistrySource = (typeof AGENT_REGISTRY_SOURCES)[number];

/**
 * `managed`: defined in a LangWatch project. `discovered`: listed by a governance source.
 * `observed`: named only by the organisation's traces (`gen_ai.agent.name`).
 */
export const AGENT_REGISTRY_MANAGEMENT = ["managed", "discovered", "observed"] as const;
export const AGENT_REGISTRY_STATUSES = ["active", "removed"] as const;
export type AgentRegistryStatus = (typeof AGENT_REGISTRY_STATUSES)[number];

const jsonSchemaObject = z.record(z.string(), z.unknown());

const agentRegistryToolSchemaDefinition = z.object({
  name: z.string(),
  description: z.string().nullable(),
  /** JSON Schema (draft 2020-12) of the tool's arguments. */
  input_schema: jsonSchemaObject,
  output_schema: jsonSchemaObject.nullable(),
  status: z.enum(["active", "deprecated"]),
  deprecated_in_version: z.number().int().positive().nullable(),
  deprecated_at: z.string().nullable(),
});
export interface AgentRegistryToolSchema extends Named<typeof agentRegistryToolSchemaDefinition> {}
export const agentRegistryToolSchema: AgentRegistryToolSchema = agentRegistryToolSchemaDefinition;
export type AgentRegistryTool = z.infer<typeof agentRegistryToolSchema>;

const agentRegistryEndpointSchemaDefinition = z.object({
  /** `invoke` calls the agent, `definition` reads it, `console` opens it for a person. */
  kind: z.enum(["invoke", "definition", "console"]),
  url: z.string(),
  protocol: z.string(),
});
export interface AgentRegistryEndpointSchema extends Named<
  typeof agentRegistryEndpointSchemaDefinition
> {}
export const agentRegistryEndpointSchema: AgentRegistryEndpointSchema =
  agentRegistryEndpointSchemaDefinition;
export type AgentRegistryEndpoint = z.infer<typeof agentRegistryEndpointSchema>;

const agentRegistryModelSchemaDefinition = z.object({
  provider: z.string().nullable(),
  model: z.string(),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
export interface AgentRegistryModelSchema extends Named<
  typeof agentRegistryModelSchemaDefinition
> {}
export const agentRegistryModelSchema: AgentRegistryModelSchema =
  agentRegistryModelSchemaDefinition;
export type AgentRegistryModel = z.infer<typeof agentRegistryModelSchema>;

const agentRegistryEntrySchemaDefinition = z.object({
  id: z.string(),
  source: z.enum(AGENT_REGISTRY_SOURCES),
  management: z.enum(AGENT_REGISTRY_MANAGEMENT),
  /** The agent's kind at its source: `signature`, `connected`, `http`, `genie_space`, ... */
  kind: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(AGENT_REGISTRY_STATUSES),
  /** Seen in traffic while no listed source (a LangWatch agent or a governance source) names it. */
  shadow: z.boolean(),
  /** The registry's version: one more on every material change. */
  version: z.number().int().positive(),
  /** The version the source itself names, when it names one. */
  source_version: z.string().nullable(),
  project_id: z.string().nullable(),
  environment: z.string().nullable(),
  owner: z.object({ user_id: z.string(), name: z.string().nullable() }).nullable(),
  endpoints: agentRegistryEndpointSchema.array(),
  model: agentRegistryModelSchema.nullable(),
  instructions: z.string().nullable(),
  capabilities: z.string().array(),
  tools: agentRegistryToolSchema.array(),
  first_seen_at: z.string(),
  last_seen_at: z.string().nullable(),
  updated_at: z.string(),
  removed_at: z.string().nullable(),
});
export interface AgentRegistryEntrySchema extends Named<
  typeof agentRegistryEntrySchemaDefinition
> {}
export const agentRegistryEntrySchema: AgentRegistryEntrySchema =
  agentRegistryEntrySchemaDefinition;
export type AgentRegistryEntry = z.infer<typeof agentRegistryEntrySchema>;

export const AGENT_REGISTRY_EVENT_TYPES = [
  "governance.agent.registered",
  "governance.agent.versioned",
  "governance.agent.removed",
  "governance.agent.tool_deprecated",
  "governance.agent.flagged_shadow",
] as const;
export type AgentRegistryEventType = (typeof AGENT_REGISTRY_EVENT_TYPES)[number];

const agentRegistryEventSchemaDefinition = z.object({
  id: z.string(),
  /** The organisation's feed position, a decimal string; the pull cursor. */
  sequence: z.string(),
  type: z.enum(AGENT_REGISTRY_EVENT_TYPES),
  organization_id: z.string(),
  agent_id: z.string(),
  from_version: z.number().int().positive().nullable(),
  to_version: z.number().int().positive().nullable(),
  /** The deprecated tool's name on `governance.agent.tool_deprecated`, else null. */
  tool: z.string().nullable(),
  occurred_at: z.string(),
  /** The entry as it stood at `to_version`. */
  agent: agentRegistryEntrySchema,
});
export interface AgentRegistryEventSchema extends Named<
  typeof agentRegistryEventSchemaDefinition
> {}
export const agentRegistryEventSchema: AgentRegistryEventSchema =
  agentRegistryEventSchemaDefinition;
export type AgentRegistryEvent = z.infer<typeof agentRegistryEventSchema>;

export const AGENT_REGISTRY_PAGE_LIMIT_MAX = 200;
/** The most active agents the ARD manifest and search read, oldest update first. */
export const AGENT_REGISTRY_ARD_ENTRY_LIMIT = 1000;

const agentRegistryListQuerySchemaDefinition = z.object({
  limit: z.coerce.number().int().min(1).max(AGENT_REGISTRY_PAGE_LIMIT_MAX).default(50),
  cursor: z.string().min(1).optional(),
  updated_since: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(AGENT_REGISTRY_STATUSES).optional(),
});
export interface AgentRegistryListQuerySchema extends Named<
  typeof agentRegistryListQuerySchemaDefinition
> {}
export const agentRegistryListQuerySchema: AgentRegistryListQuerySchema =
  agentRegistryListQuerySchemaDefinition;

const agentRegistryListResponseSchemaDefinition = z.object({
  data: agentRegistryEntrySchema.array(),
  next_cursor: z.string().nullable(),
});
export interface AgentRegistryListResponseSchema extends Named<
  typeof agentRegistryListResponseSchemaDefinition
> {}
export const agentRegistryListResponseSchema: AgentRegistryListResponseSchema =
  agentRegistryListResponseSchemaDefinition;
export type AgentRegistryPage = z.infer<typeof agentRegistryListResponseSchema>;

const agentRegistryParamsSchemaDefinition = z.object({ agentId: z.string().min(1) });
export interface AgentRegistryParamsSchema extends Named<
  typeof agentRegistryParamsSchemaDefinition
> {}
export const agentRegistryParamsSchema: AgentRegistryParamsSchema =
  agentRegistryParamsSchemaDefinition;

const agentRegistryDetailResponseSchemaDefinition = z.object({ data: agentRegistryEntrySchema });
export interface AgentRegistryDetailResponseSchema extends Named<
  typeof agentRegistryDetailResponseSchemaDefinition
> {}
export const agentRegistryDetailResponseSchema: AgentRegistryDetailResponseSchema =
  agentRegistryDetailResponseSchemaDefinition;

const agentRegistryEventsQuerySchemaDefinition = z.object({
  limit: z.coerce.number().int().min(1).max(AGENT_REGISTRY_PAGE_LIMIT_MAX).default(100),
  /** The last `sequence` read; events after it are returned in order. */
  cursor: z.string().regex(/^\d+$/).optional(),
});
export interface AgentRegistryEventsQuerySchema extends Named<
  typeof agentRegistryEventsQuerySchemaDefinition
> {}
export const agentRegistryEventsQuerySchema: AgentRegistryEventsQuerySchema =
  agentRegistryEventsQuerySchemaDefinition;

const agentRegistryEventsResponseSchemaDefinition = z.object({
  data: agentRegistryEventSchema.array(),
  /** Pass back as `cursor`; null when the page was the last. */
  next_cursor: z.string().nullable(),
});
export interface AgentRegistryEventsResponseSchema extends Named<
  typeof agentRegistryEventsResponseSchemaDefinition
> {}
export const agentRegistryEventsResponseSchema: AgentRegistryEventsResponseSchema =
  agentRegistryEventsResponseSchemaDefinition;
export type AgentRegistryEventPage = z.infer<typeof agentRegistryEventsResponseSchema>;

/** The JSON Schema documents a consumer validates entries and events with. */
const agentRegistrySchemaResponseSchemaDefinition = z.object({
  entry: jsonSchemaObject,
  event: jsonSchemaObject,
});
export interface AgentRegistrySchemaResponseSchema extends Named<
  typeof agentRegistrySchemaResponseSchemaDefinition
> {}
export const agentRegistrySchemaResponseSchema: AgentRegistrySchemaResponseSchema =
  agentRegistrySchemaResponseSchemaDefinition;
