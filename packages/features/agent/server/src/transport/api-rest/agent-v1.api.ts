/**
 * The `/api/v1/agents` REST family: list, create, read, update, archive,
 * test, call and the HTTP long-poll `/connect/*` routes (ADR-128).
 */

import {
  AgentNotFoundError,
  AgentRegisterOnlyError,
  CONNECTED_AGENT_NOT_SELECTABLE_REASONS,
  agentTypeSchema,
  InvalidAgentConfigError,
  createAgentRequestSchema,
  updateAgentRequestSchema,
} from "@langwatch/agent-contract";
import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  createFamilyErrorHandler,
  type EndpointVariables,
  managementActor,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  NotFoundError,
  projectOf,
  type ProjectScopedContext,
  type RestApiVersionedFamily,
  resolver,
  UnprocessableEntityError,
} from "@langwatch/api/rest";
import { scenarioParameterDefinitionSchema } from "@langwatch/scenario-contract";
import type { ErrorHandler } from "hono";
import { z } from "zod";

import { AgentApp } from "#app/agent.app";
import type { ConnectedAgentRuntime } from "../../ports/connected-agent-runtime.port.ts";
import type { LongPollTransportService } from "../../services/connected-agent-long-poll.service.ts";
import {
  ConnectedAgentPresenceService,
  NO_PRESENCE,
  type AgentPresence,
} from "../../services/connected-agent-presence.service.ts";
import { agentListRowOf, type AgentListRow } from "../../rules/agent-view.rules.ts";
import { registerCallEndpoint, type AgentCallDeps } from "./agent-call.api.ts";
import { registerConnectEndpoints } from "./agent-connect.api.ts";
import type { AgentPlatformUrlBuilder } from "./agent-legacy.api.ts";

// ── schemas ──────────────────────────────────────────────────────────────────

const idParamsSchema = z.object({
  id: z.string().min(1).describe("The agent id."),
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

/** The presence and owner fields every agent read carries (ADR-128). */
const agentInstanceSchema = z.object({
  instanceId: z.string(),
  hostname: z.string(),
  username: z.string(),
  pid: z.number(),
  label: z.string().nullable(),
  sdk: z.object({
    name: z.string(),
    version: z.string(),
    language: z.string(),
  }),
  connectedAt: z.date(),
  inflight: z.number(),
  maxConcurrency: z.number(),
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
    .array(scenarioParameterDefinitionSchema)
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
    .array(agentInstanceSchema)
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

const agentListResponseSchema = z.object({
  data: z.array(agentResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

const archiveResultSchema = z.object({
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

type AgentWire = z.infer<typeof agentResponseSchema>;

/** What the family builds every route's handler on. */
export interface AgentsV1Deps {
  security: AppRestSecurity;
  /**
   * The feature's application, as a provider: mounting the family must not
   * force its services to be constructed.
   */
  agents: () => AgentApp;
  agentPlatformUrl: AgentPlatformUrlBuilder;
  /** Absent when this process composes no connected-agent runtime. */
  connectedRuntime?: () => ConnectedAgentRuntime | undefined;
  /** Absent when this process composes no connected-agent transport. */
  connect?: {
    transport: () => LongPollTransportService;
    /** `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB`; the default cap when absent. */
    relayMaxPayloadMb?: number;
  };
  /** Absent when this process composes no connected-agent runtime. */
  call?: Omit<AgentCallDeps, "agents">;
}

// ── wire helpers ─────────────────────────────────────────────────────────────

/** Presence for the given agents, or every one offline when no runtime runs here. */
async function presenceOf({
  deps,
  projectId,
  rows,
}: {
  deps: AgentsV1Deps;
  projectId: string;
  rows: readonly { id: string; type: string }[];
}): Promise<Map<string, AgentPresence>> {
  const runtime = deps.connectedRuntime?.();
  if (!runtime) return new Map(rows.map((row) => [row.id, NO_PRESENCE]));
  return ConnectedAgentPresenceService.readAgentPresence({ projectId, agents: rows, runtime });
}

/**
 * The person the request's key belongs to, or nothing for a project or service
 * key. It decides only what each row says about itself: a personal agent of
 * somebody else is listed either way, marked as not selectable.
 */
function viewerUserIdOf(c: AgentsV1Context): string | null {
  return (c.get("apiKeyUserId") as string | null) ?? null;
}

/** The rows as every read answers them: presence, owner and link added. */
async function rowsWire({
  deps,
  projectId,
  projectSlug,
  rows,
  viewerUserId,
}: {
  deps: AgentsV1Deps;
  projectId: string;
  projectSlug: string;
  rows: AgentListRow[];
  /** The person the key belongs to; nothing for a project or service key. */
  viewerUserId: string | null;
}): Promise<AgentWire[]> {
  const [owners, presence] = await Promise.all([
    deps.agents().ownersOf(rows),
    presenceOf({ deps, projectId, rows }),
  ]);
  return rows.map((row) => ({
    ...row,
    type: agentTypeSchema.parse(row.type),
    ...ConnectedAgentPresenceService.agentPresenceView({
      agent: row,
      owners,
      presence,
      viewerUserId,
    }),
    platformUrl: deps.agentPlatformUrl({
      projectSlug,
      agentId: row.id,
      agentType: row.type,
    }),
  }));
}

async function agentWire({
  deps,
  projectId,
  projectSlug,
  agent,
  viewerUserId,
}: {
  deps: AgentsV1Deps;
  projectId: string;
  projectSlug: string;
  agent: Parameters<typeof agentListRowOf>[0];
  viewerUserId: string | null;
}): Promise<AgentWire> {
  const [wire] = await rowsWire({
    deps,
    projectId,
    projectSlug,
    rows: [agentListRowOf(agent)],
    viewerUserId,
  });
  return wire!;
}

// ── the family ───────────────────────────────────────────────────────────────

/** The handler context every route in this family runs on. */
type AgentsV1Context = ProjectScopedContext<EndpointVariables>;

/** Builds the `/api/v1/agents` collection, item and archive endpoints. */
export function createAgentV1RestApp(deps: AgentsV1Deps): MountableRestApp {
  const { security } = deps;

  const agentErrorHandler = (spine: ErrorHandler): ErrorHandler => {
    const boundary = createFamilyErrorHandler({
      loggerName: "langwatch:api:v1:agents:errors",
      label: "Agent API Error",
      boundary: spine,
    });
    return (error, c) => {
      if (error instanceof AgentNotFoundError) {
        return boundary(new NotFoundError(error.message), c);
      }
      if (error instanceof InvalidAgentConfigError) {
        return boundary(new UnprocessableEntityError(error.message), c);
      }
      return boundary(error, c);
    };
  };

  const family = security.createProjectVersionedApp({
    name: "agents-v1",
    basePath: "/api/v1/agents",
    errorEnvelope: "legacy",
    errorHandler: agentErrorHandler,
    staticGeneration: "v1",
  });

  // The static `/connect/*` paths are registered first, or `/:id` would
  // answer for the segment "connect".
  if (deps.connect) {
    registerConnectEndpoints({
      family,
      transport: deps.connect.transport,
      ...(deps.connect.relayMaxPayloadMb === undefined
        ? {}
        : { relayMaxPayloadMb: deps.connect.relayMaxPayloadMb }),
    });
  }
  registerCollectionEndpoints({ family, deps });
  registerItemEndpoints({ family, deps });
  registerArchiveEndpoint({ family, deps });
  registerTestEndpoint({ family, deps });
  if (deps.call) {
    registerCallEndpoint({
      family,
      deps: { agents: deps.agents, ...deps.call },
    });
  }

  return family.service.build();
}

function registerCollectionEndpoints({
  family,
  deps,
}: {
  family: RestApiVersionedFamily;
  deps: AgentsV1Deps;
}): void {
  const listHandler = async (c: AgentsV1Context, input: z.infer<typeof paginationQuerySchema>) => {
    const project = projectOf(c);
    const result = await deps.agents().list({
      projectId: project.id,
      page: input.page,
      limit: input.limit,
    });

    return {
      pagination: result.pagination,
      data: await rowsWire({
        deps,
        projectId: project.id,
        projectSlug: project.slug,
        rows: result.data.map(agentListRowOf),
        viewerUserId: viewerUserIdOf(c),
      }),
    };
  };

  const createHandler = async (
    c: AgentsV1Context,
    input: z.infer<typeof createAgentRequestSchema>,
  ) => {
    const project = projectOf(c);

    // A connected agent is registered by the SDK from the process that runs
    // it; a request body cannot stand in for that process.
    if (input.type === "connected") throw new AgentRegisterOnlyError();

    const agent = await deps.agents().create({
      ...input,
      id: AgentApp.nextAgentId(),
      projectId: project.id,
    });

    return await agentWire({
      deps,
      projectId: project.id,
      projectSlug: project.slug,
      agent,
      viewerUserId: viewerUserIdOf(c),
    });
  };

  family.service
    .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
      family
        .policy(requires("project:view"))(b)
        .withQuery(paginationQuerySchema)
        .withOutput(agentListResponseSchema)
        .withDocs({
          operationId: "listAgents",
          tags: ["Agents"],
          description:
            "List the project's agents, paginated, with the presence and owner of each connected agent. Archived agents are left out.",
          responses: {
            200: {
              description: "Success",
              content: { "application/json": { schema: resolver(agentListResponseSchema) } },
            },
          },
        }),
    )
    .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
      family
        .policy(requires("project:update"))(b)
        .withInput(createAgentRequestSchema)
        .withOutput(agentResponseSchema)
        .withStatus(201)
        .withDocs({
          operationId: "createAgent",
          tags: ["Agents"],
          description:
            "Create an agent from a name, a type and the configuration of that type. A connected agent is registered from code by the SDK and answers 422 agent_register_only here.",
          responses: {
            201: {
              description: "Agent created",
              content: { "application/json": { schema: resolver(agentResponseSchema) } },
            },
          },
        }),
    );
}

function registerItemEndpoints({
  family,
  deps,
}: {
  family: RestApiVersionedFamily;
  deps: AgentsV1Deps;
}): void {
  const getHandler = async (c: AgentsV1Context, input: z.infer<typeof idParamsSchema>) => {
    const project = projectOf(c);
    const agent = await deps.agents().getById({ id: input.id, projectId: project.id });
    return await agentWire({
      deps,
      projectId: project.id,
      projectSlug: project.slug,
      agent,
      viewerUserId: viewerUserIdOf(c),
    });
  };

  const updateHandler = async (
    c: AgentsV1Context,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof updateAgentRequestSchema>,
  ) => {
    const project = projectOf(c);
    const { id, ...body } = input;
    const agent = await deps.agents().update({ ...body, id, projectId: project.id });
    return await agentWire({
      deps,
      projectId: project.id,
      projectSlug: project.slug,
      agent,
      viewerUserId: viewerUserIdOf(c),
    });
  };

  family.service.registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getHandler, (b) =>
    family
      .policy(requires("project:view"))(b)
      .withParams(idParamsSchema)
      .withOutput(agentResponseSchema)
      .withDocs({
        operationId: "getAgent",
        tags: ["Agents"],
        description:
          "Read one agent with its presence, its owner and the run parameters it declares. An id the project does not hold answers 404 agent_not_found.",
        responses: {
          200: {
            description: "Success",
            content: { "application/json": { schema: resolver(agentResponseSchema) } },
          },
        },
      }),
  );

  // Registered under both verbs. The update is partial either way, so a
  // caller reaching for the other verb gets the same behavior instead of a 404.
  for (const [verb, operationId] of [
    ["patch", "updateAgent"],
    ["put", "replaceAgent"],
  ] as const) {
    family.service.registerRoute(verb, "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
      family
        .policy(requires("project:update"))(b)
        .withParams(idParamsSchema)
        .withInput(updateAgentRequestSchema)
        .withOutput(agentResponseSchema)
        .withDocs({
          operationId,
          tags: ["Agents"],
          description:
            "Update an agent: any of name, type, configuration and workflow. The update is partial under PATCH and PUT alike. A connected agent takes no edit and answers 422 agent_register_only.",
          responses: {
            200: {
              description: "Success",
              content: { "application/json": { schema: resolver(agentResponseSchema) } },
            },
          },
        }),
    );
  }
}

function registerArchiveEndpoint({
  family,
  deps,
}: {
  family: RestApiVersionedFamily;
  deps: AgentsV1Deps;
}): void {
  const archiveHandler = async (c: AgentsV1Context, input: z.infer<typeof idParamsSchema>) => {
    const agent = await deps.agents().archive({ id: input.id, projectId: projectOf(c).id });
    return {
      id: agent.id,
      name: agent.name,
      type: agentTypeSchema.parse(agent.type),
      archivedAt: agent.archivedAt,
    };
  };

  family.service.registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, archiveHandler, (b) =>
    family
      .policy(requires("project:delete"))(b)
      .withParams(idParamsSchema)
      .withOutput(archiveResultSchema)
      .withDocs({
        operationId: "archiveAgent",
        tags: ["Agents"],
        description:
          "Archive an agent. It leaves the list and its runs stay. A connected agent that registers again restores its row.",
        responses: {
          200: {
            description: "Success",
            content: { "application/json": { schema: resolver(archiveResultSchema) } },
          },
        },
      }),
  );
}

/** `POST /:id/test`, the one-off scripted run. */
function registerTestEndpoint({
  family,
  deps,
}: {
  family: RestApiVersionedFamily;
  deps: AgentsV1Deps;
}): void {
  const testHandler = async (c: AgentsV1Context, input: z.infer<typeof idParamsSchema>) =>
    agentTestRunResponseSchema.parse(
      await deps.agents().testRun({
        agentId: input.id,
        projectId: projectOf(c).id,
        actorId: managementActor(c),
      }),
    );

  family.service.registerRoute("post", "/:id/test", MANAGEMENT_API_VERSION, testHandler, (b) =>
    family
      .policy(requires("scenarios:create"))(b)
      .withParams(idParamsSchema)
      .withOutput(agentTestRunResponseSchema)
      .withDocs({
        operationId: "testAgent",
        tags: ["Agents"],
        description:
          'Run one scripted scenario against an agent: the user sends "ping", the agent answers, and the run succeeds when the answer arrives. No model is used, and no scenario, run plan or test suite is added to the project. Answers at once with the run ids; the run itself is asynchronous.',
        responses: {
          200: {
            description: "The run's ids",
            content: { "application/json": { schema: resolver(agentTestRunResponseSchema) } },
          },
          403: { description: "The agent is a personal development agent of someone else" },
          404: { description: "No agent with that id in this project" },
          422: { description: "The agent cannot be tested as it is set up" },
        },
      }),
  );
}
