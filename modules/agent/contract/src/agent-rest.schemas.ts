import { z } from "zod";
import { agentTypeSchema } from "./config/index.ts";
import { CONNECTED_AGENT_NOT_SELECTABLE_REASONS } from "./connected-agent.selectable.ts";
import { connectedParameterDefinitionSchema } from "./config/connected.ts";
import { connectedAgentInstanceSchema } from "./connected-agent.view.ts";

export const agentRestParamsSchema = z.object({
  id: z.string().min(1).describe("The agent id."),
});

export const agentRestQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

export const agentResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: agentTypeSchema.describe(
    "The kind of agent. A connected agent is registered from code by the SDK and cannot be created or reconfigured through this API.",
  ),
  config: z.record(z.string(), z.unknown()).nullable(),
  environment: z
    .string()
    .nullable()
    .describe(
      "The environment a connected agent registered with, for example production or development. Null for every other kind.",
    ),
  ownerUserId: z
    .string()
    .nullable()
    .describe(
      "The user a personal development agent belongs to. Only that user can run simulations against it. Null when the agent is shared.",
    ),
  hostLabel: z
    .string()
    .nullable()
    .describe(
      "The machine a development agent registered from with a project or service key. Null when the agent is personal or shared.",
    ),
  lastSeenAt: z
    .date()
    .nullable()
    .describe(
      "When an instance of a connected agent was last connected. Null for every other kind.",
    ),
  parameters: z
    .array(connectedParameterDefinitionSchema)
    .describe(
      "The run parameters a connected agent declares from its function signature: name, type, options, default and description. Empty for every other kind.",
    ),
  owner: z
    .object({ userId: z.string(), name: z.string().nullable() })
    .nullable()
    .describe(
      "The person a personal development agent belongs to. Null when the agent is shared or host-scoped.",
    ),
  status: z
    .enum(["online", "offline"])
    .describe(
      "online while at least one process running the connected agent is connected; offline otherwise, and always for every other kind.",
    ),
  instances: z
    .array(connectedAgentInstanceSchema)
    .describe(
      "The processes currently connected for a connected agent: hostname, user, pid, SDK and how many calls each has in flight. Empty for every other kind.",
    ),
  selectable: z
    .boolean()
    .describe(
      "Whether the credential making this request can run simulations against the agent. False for a personal development agent that belongs to somebody else, which is listed all the same so it can be told apart from the other agents of the same name.",
    ),
  notSelectableReason: z
    .enum(CONNECTED_AGENT_NOT_SELECTABLE_REASONS)
    .nullable()
    .describe("Why the agent cannot be run by this credential. Null when it can."),
  createdAt: z.date(),
  updatedAt: z.date(),
  platformUrl: z.string().url(),
});

export const agentListResponseSchema = z.object({
  data: z.array(agentResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export const archiveResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: agentTypeSchema,
  archivedAt: z.date().nullable(),
});

export const agentTestRunResponseSchema = z.object({
  scenarioRunId: z.string().describe("The run to follow; open it in the simulations run drawer."),
  batchRunId: z.string().describe("The batch the run belongs to."),
  setId: z.string().describe("The internal set that holds agent test runs."),
});
