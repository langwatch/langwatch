/**
 * The `/api/v1/agents` REST family: list, create, read, update, archive,
 * test, call and the HTTP long-poll `/connect/*` routes (ADR-128).
 *
 * Every read carries the presence and owner of a connected agent, and the run
 * parameters it declares, so a caller of this family never has to ask a
 * second endpoint whether an instance is online. The `/connect/*` and
 * `/:id/call` routes are registered from {@link ./agent-connect.api} and
 * {@link ./agent-call.api} — kept apart because they need dependencies (the
 * connected runtime, the long-poll transport, the owner-only run guard) this
 * file's own collection/item/archive/test routes do not.
 */

import {
  AgentNotFoundError,
  AgentRegisterOnlyError,
  agentTypeSchema,
  InvalidAgentConfigError,
  createAgentRequestSchema,
  updateAgentRequestSchema,
} from "@langwatch/agent-contract";
import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  createFamilyErrorHandler,
  managementActor,
  NotFoundError,
  type SecuredApp,
  UnprocessableEntityError,
  validator as zValidator,
} from "@langwatch/api/rest";
import { scenarioParameterDefinitionSchema } from "@langwatch/scenario-contract";
import type { ErrorHandler } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import { AgentApp } from "#app/agent.app";
import type { ConnectedAgentRuntime } from "../../services/connected-agent-runtime.service";
import type { LongPollTransport } from "../../services/connected-agent-long-poll.service";
import {
  agentPresenceView,
  NO_PRESENCE,
  readAgentPresence,
  type AgentPresence,
} from "../../services/connected-agent-presence.service";
import {
  toAgentListRow,
  type AgentListRow,
} from "../../services/agent.service";
import {
  registerCallEndpoint,
  type AgentCallDeps,
} from "./agent-call.api";
import { registerConnectEndpoints } from "./agent-connect.api";
import type { AgentPlatformUrlBuilder } from "./agent-legacy.api";

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
  scenarioRunId: z
    .string()
    .describe("The run to follow; open it in the simulations run drawer."),
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
  connect?: { transport: () => LongPollTransport };
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
  return readAgentPresence({ projectId, agents: rows, runtime });
}

/** The rows as every read answers them: presence, owner and link added. */
async function rowsWire({
  deps,
  projectId,
  projectSlug,
  rows,
}: {
  deps: AgentsV1Deps;
  projectId: string;
  projectSlug: string;
  rows: AgentListRow[];
}): Promise<AgentWire[]> {
  const [owners, presence] = await Promise.all([
    deps.agents().ownersOf(rows),
    presenceOf({ deps, projectId, rows }),
  ]);
  return rows.map((row) => ({
    ...row,
    type: agentTypeSchema.parse(row.type),
    ...agentPresenceView({ agent: row, owners, presence }),
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
}: {
  deps: AgentsV1Deps;
  projectId: string;
  projectSlug: string;
  agent: Parameters<typeof toAgentListRow>[0];
}): Promise<AgentWire> {
  const [wire] = await rowsWire({
    deps,
    projectId,
    projectSlug,
    rows: [toAgentListRow(agent)],
  });
  return wire!;
}

// ── the family ───────────────────────────────────────────────────────────────

/** Builds the `/api/v1/agents` collection, item and archive endpoints. */
export function createAgentV1RestApp(
  deps: AgentsV1Deps,
): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security } = deps;
  const secured = security.createProjectApp({ basePath: "/api/v1/agents" });

  const boundary = createFamilyErrorHandler({
    loggerName: "langwatch:api:v1:agents:errors",
    label: "Agent API Error",
    boundary: security.legacyErrorHandler,
  });

  const handleAgentError: ErrorHandler = (error, c) => {
    if (error instanceof AgentNotFoundError) {
      return boundary(new NotFoundError(error.message), c);
    }
    if (error instanceof InvalidAgentConfigError) {
      return boundary(new UnprocessableEntityError(error.message), c);
    }
    return boundary(error, c);
  };
  secured.hono.onError(handleAgentError);

  // The static `/connect/*` paths are registered first, or `/:id` would
  // answer for the segment "connect".
  if (deps.connect) {
    registerConnectEndpoints({ secured, transport: deps.connect.transport });
  }
  registerCollectionEndpoints({ secured, deps });
  registerItemEndpoints({ secured, deps });
  registerArchiveEndpoint({ secured, deps });
  registerTestEndpoint({ secured, deps });
  if (deps.call) {
    registerCallEndpoint({
      secured,
      deps: { agents: deps.agents, ...deps.call },
    });
  }

  return secured;
}

function registerCollectionEndpoints({
  secured,
  deps,
}: {
  secured: SecuredApp<{ Variables: AppRestProjectVariables }>;
  deps: AgentsV1Deps;
}): void {
  secured.access(requires("project:view")).get(
    "/",
    describeRoute({
      operationId: "listAgents",
      tags: ["Agents"],
      description:
        "List the project's agents, paginated, with the presence and owner of each connected agent. Archived agents are left out.",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": { schema: resolver(agentListResponseSchema) },
          },
        },
      },
    }),
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const project = c.get("project");
      const { page, limit } = c.req.valid("query");

      const result = await deps.agents().list({
        projectId: project.id,
        page,
        limit,
      });

      return c.json({
        pagination: result.pagination,
        data: await rowsWire({
          deps,
          projectId: project.id,
          projectSlug: project.slug,
          rows: result.data.map(toAgentListRow),
        }),
      });
    },
  );

  secured.access(requires("project:update")).post(
    "/",
    describeRoute({
      operationId: "createAgent",
      tags: ["Agents"],
      description:
        "Create an agent from a name, a type and the configuration of that type. A connected agent is registered from code by the SDK and answers 422 agent_register_only here.",
      responses: {
        201: {
          description: "Agent created",
          content: {
            "application/json": { schema: resolver(agentResponseSchema) },
          },
        },
      },
    }),
    zValidator("json", createAgentRequestSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");

      // A connected agent is registered by the SDK from the process that runs
      // it; a request body cannot stand in for that process.
      if (body.type === "connected") throw new AgentRegisterOnlyError();

      const agent = await deps.agents().create({
        ...body,
        id: AgentApp.nextAgentId(),
        projectId: project.id,
      });

      return c.json(
        await agentWire({
          deps,
          projectId: project.id,
          projectSlug: project.slug,
          agent,
        }),
        201,
      );
    },
  );
}

function registerItemEndpoints({
  secured,
  deps,
}: {
  secured: SecuredApp<{ Variables: AppRestProjectVariables }>;
  deps: AgentsV1Deps;
}): void {
  secured.access(requires("project:view")).get(
    "/:id",
    describeRoute({
      operationId: "getAgent",
      tags: ["Agents"],
      description:
        "Read one agent with its presence, its owner and the run parameters it declares. An id the project does not hold answers 404 agent_not_found.",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": { schema: resolver(agentResponseSchema) },
          },
        },
      },
    }),
    zValidator("param", idParamsSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const project = c.get("project");

      const agent = await deps.agents().getById({ id, projectId: project.id });

      return c.json(
        await agentWire({
          deps,
          projectId: project.id,
          projectSlug: project.slug,
          agent,
        }),
      );
    },
  );

  // Registered under both verbs. The update is partial either way, so a
  // caller reaching for the other verb gets the same behavior instead of a 404.
  for (const [verb, operationId] of [
    ["patch", "updateAgent"],
    ["put", "replaceAgent"],
  ] as const) {
    secured.access(requires("project:update"))[verb](
      "/:id",
      describeRoute({
        operationId,
        tags: ["Agents"],
        description:
          "Update an agent: any of name, type, configuration and workflow. The update is partial under PATCH and PUT alike. A connected agent takes no edit and answers 422 agent_register_only.",
        responses: {
          200: {
            description: "Success",
            content: {
              "application/json": { schema: resolver(agentResponseSchema) },
            },
          },
        },
      }),
      zValidator("param", idParamsSchema),
      zValidator("json", updateAgentRequestSchema),
      async (c) => {
        const { id } = c.req.valid("param");
        const project = c.get("project");
        const body = c.req.valid("json");

        const agent = await deps.agents().update({
          ...body,
          id,
          projectId: project.id,
        });

        return c.json(
          await agentWire({
            deps,
            projectId: project.id,
            projectSlug: project.slug,
            agent,
          }),
        );
      },
    );
  }
}

function registerArchiveEndpoint({
  secured,
  deps,
}: {
  secured: SecuredApp<{ Variables: AppRestProjectVariables }>;
  deps: AgentsV1Deps;
}): void {
  secured.access(requires("project:delete")).delete(
    "/:id",
    describeRoute({
      operationId: "archiveAgent",
      tags: ["Agents"],
      description:
        "Archive an agent. It leaves the list and its runs stay. A connected agent that registers again restores its row.",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": { schema: resolver(archiveResultSchema) },
          },
        },
      },
    }),
    zValidator("param", idParamsSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const project = c.get("project");

      const agent = await deps.agents().archive({ id, projectId: project.id });
      return c.json({
        id: agent.id,
        name: agent.name,
        type: agentTypeSchema.parse(agent.type),
        archivedAt: agent.archivedAt,
      });
    },
  );
}

/** `POST /:id/test`, the one-off scripted run. */
function registerTestEndpoint({
  secured,
  deps,
}: {
  secured: SecuredApp<{ Variables: AppRestProjectVariables }>;
  deps: AgentsV1Deps;
}): void {
  secured.access(requires("scenarios:create")).post(
    "/:id/test",
    describeRoute({
      operationId: "testAgent",
      tags: ["Agents"],
      description:
        'Run one scripted scenario against an agent: the user sends "ping", the agent answers, and the run succeeds when the answer arrives. No model is used, and no scenario, run plan or test suite is added to the project. Answers at once with the run ids; the run itself is asynchronous.',
      responses: {
        200: {
          description: "The run's ids",
          content: {
            "application/json": {
              schema: resolver(agentTestRunResponseSchema),
            },
          },
        },
        403: {
          description: "The agent is a personal development agent of someone else",
        },
        404: { description: "No agent with that id in this project" },
        422: { description: "The agent cannot be tested as it is set up" },
      },
    }),
    zValidator("param", idParamsSchema),
    async (c) => {
      const { id } = c.req.valid("param");
      const project = c.get("project");

      const run = await deps.agents().testRun({
        agentId: id,
        projectId: project.id,
        actorId: managementActor(c),
      });
      return c.json(agentTestRunResponseSchema.parse(run));
    },
  );
}
