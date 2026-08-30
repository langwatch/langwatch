/**
 * The agents REST family: list, create, read, update, archive and test.
 *
 * Registered by both `app.ts`, the `/api/v1/agents` family, and `alias.ts`,
 * the deprecated `/api/agents` alias, from one declaration per endpoint. The
 * alias serves the same handlers and hides its operations from the document,
 * so the reference names one path per operation.
 */

import type { BaseApp, VersionBuilder } from "@langwatch/api";
import type { AuthzPermission } from "@langwatch/authz";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Project } from "~/generated/prisma/client";
import {
  type AgentComponentConfig,
  agentTypeSchema,
} from "~/server/agents/agent.repository";
import {
  type AgentListRow,
  type AgentService,
  toAgentListRow,
} from "~/server/agents/agent.service";
import { AgentRegisterOnlyError } from "~/server/agents/errors";
import type { ProjectEndpointMeta } from "~/server/api/v1/project-service";
import {
  agentPresenceView,
  readAgentPresence,
} from "~/server/connected-agents/presence.read";
import { scenarioParameterDefinitionSchema } from "~/server/scenarios/parameters";
import { runActorOf } from "../../shared/run-actor";
import { agentPlatformUrl } from "../agent-platform-url";

export type AgentsApp = BaseApp<Project> & {
  agents: AgentService;
};
export type AgentsVersion = VersionBuilder<AgentsApp>;
export type AgentsGuard = (permission: AuthzPermission) => {
  meta: ProjectEndpointMeta;
  permission: AuthzPermission;
};

// ── schemas ──────────────────────────────────────────────────────────────────

const idParamsSchema = z.object({
  id: z.string().min(1).describe("The agent id."),
});

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

/**
 * The `type` a write request may carry.
 *
 * "connected" stays in the enum on purpose. A connected agent is registered
 * from code by the SDK, so a write that names it is refused 422
 * `agent_register_only`, which tells the caller why. Dropping the value from
 * the enum would answer the same request with a plain schema rejection and no
 * reason.
 */
const writableAgentTypeSchema = agentTypeSchema.describe(
  'The kind of agent to write. A connected agent is registered from code by the SDK, so "connected" is refused with agent_register_only.',
);

const createAgentSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
  type: writableAgentTypeSchema,
  config: z.record(z.unknown()),
  workflowId: z.string().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: writableAgentTypeSchema.optional(),
  config: z.record(z.unknown()).optional(),
  workflowId: z.string().nullable().optional(),
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
  config: z.record(z.unknown()).nullable(),
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

const agentTestRunResponseSchema = z.object({
  scenarioRunId: z
    .string()
    .describe("The run to follow; open it in the simulations run drawer."),
  batchRunId: z.string().describe("The batch the run belongs to."),
  setId: z.string().describe("The internal set that holds agent test runs."),
});

type AgentWire = z.infer<typeof agentResponseSchema>;

// ── wire helpers ─────────────────────────────────────────────────────────────

type ReadableAgent = Parameters<typeof toAgentListRow>[0];

/** The rows as every read answers them: presence, owner and link added. */
async function rowsWire({
  app,
  rows,
}: {
  app: AgentsApp;
  rows: AgentListRow[];
}): Promise<AgentWire[]> {
  const [owners, presence] = await Promise.all([
    app.agents.ownersOf(rows),
    readAgentPresence({ projectId: app.project.id, agents: rows }),
  ]);
  return rows.map((row) => ({
    ...row,
    type: agentTypeSchema.parse(row.type),
    ...agentPresenceView({ agent: row, owners, presence }),
    platformUrl: agentPlatformUrl({
      projectSlug: app.project.slug,
      agentId: row.id,
      agentType: row.type,
    }),
  }));
}

async function agentWire({
  app,
  agent,
}: {
  app: AgentsApp;
  agent: ReadableAgent;
}): Promise<AgentWire> {
  const [wire] = await rowsWire({ app, rows: [toAgentListRow(agent)] });
  return wire!;
}

// ── endpoint registration ────────────────────────────────────────────────────

/**
 * How a family documents its endpoints: the canonical family publishes them,
 * the alias hides them so the reference holds one path per operation.
 */
export type AgentsDocs = "published" | "hidden";

function docsOf({
  docs,
  operationId,
}: {
  docs: AgentsDocs;
  operationId: string;
}) {
  return docs === "published"
    ? { operationId, tags: ["Agents"] }
    : { hide: true as const };
}

type RegisterAgents = {
  v: AgentsVersion;
  guard: AgentsGuard;
  docs: AgentsDocs;
};

export function registerAgentEndpoints(input: RegisterAgents): void {
  registerCollectionEndpoints(input);
  registerItemEndpoints(input);
  registerArchiveEndpoint(input);
}

function registerCollectionEndpoints({ v, guard, docs }: RegisterAgents): void {
  v.get(
    "/",
    {
      ...guard("project:view"),
      query: paginationQuerySchema,
      output: agentListResponseSchema,
      description:
        "List the project's agents, paginated, with the presence and owner of each connected agent. Archived agents are left out.",
      docs: docsOf({ docs, operationId: "listAgents" }),
    },
    async (
      _c,
      {
        query,
        app,
      }: {
        query: z.infer<typeof paginationQuerySchema>;
        app: AgentsApp;
      },
    ) => {
      const result = await app.agents.listAgents({
        projectId: app.project.id,
        page: query.page,
        limit: query.limit,
      });
      return {
        pagination: result.pagination,
        data: await rowsWire({ app, rows: result.data }),
      };
    },
  );

  v.post(
    "/",
    {
      ...guard("project:update"),
      input: createAgentSchema,
      output: agentResponseSchema,
      status: 201,
      description:
        "Create an agent from a name, a type and the configuration of that type. A connected agent is registered from code by the SDK and answers 422 agent_register_only here.",
      docs: docsOf({ docs, operationId: "createAgent" }),
    },
    async (
      _c,
      {
        input,
        app,
      }: { input: z.infer<typeof createAgentSchema>; app: AgentsApp },
    ) => {
      // A connected agent is registered by the SDK from the process that runs
      // it; a request body cannot stand in for that process.
      if (input.type === "connected") throw new AgentRegisterOnlyError();

      const agent = await app.agents.create({
        id: `agent_${nanoid()}`,
        projectId: app.project.id,
        name: input.name,
        type: input.type,
        config: input.config as AgentComponentConfig,
        workflowId: input.workflowId,
      });
      return agentWire({ app, agent });
    },
  );
}

function registerItemEndpoints({ v, guard, docs }: RegisterAgents): void {
  v.get(
    "/:id",
    {
      ...guard("project:view"),
      params: idParamsSchema,
      output: agentResponseSchema,
      description:
        "Read one agent with its presence, its owner and the run parameters it declares. An id the project does not hold answers 404 agent_not_found.",
      docs: docsOf({ docs, operationId: "getAgent" }),
    },
    async (_c, { params, app }: { params: { id: string }; app: AgentsApp }) => {
      const agent = await app.agents.getByIdOrThrow({
        id: params.id,
        projectId: app.project.id,
      });
      return agentWire({ app, agent });
    },
  );

  // Registered under both verbs. The update is partial either way, so a
  // caller reaching for the other verb gets the same behavior instead of a 404.
  for (const verb of ["patch", "put"] as const) {
    v[verb](
      "/:id",
      {
        ...guard("project:update"),
        params: idParamsSchema,
        input: updateAgentSchema,
        output: agentResponseSchema,
        description:
          "Update an agent: any of name, type, configuration and workflow. The update is partial under PATCH and PUT alike. A connected agent takes only a new description; anything else answers 422 agent_register_only.",
        docs: docsOf({
          docs,
          operationId: verb === "patch" ? "updateAgent" : "replaceAgent",
        }),
      },
      async (
        _c,
        {
          params,
          input,
          app,
        }: {
          params: { id: string };
          input: z.infer<typeof updateAgentSchema>;
          app: AgentsApp;
        },
      ) => {
        const agent = await app.agents.updateOrThrow({
          id: params.id,
          projectId: app.project.id,
          data: {
            ...(input.name && { name: input.name }),
            ...(input.type && { type: input.type }),
            ...(input.config && {
              config: input.config as AgentComponentConfig,
            }),
            ...(input.workflowId !== undefined && {
              workflowId: input.workflowId,
            }),
          },
        });
        return agentWire({ app, agent });
      },
    );
  }
}

function registerArchiveEndpoint({ v, guard, docs }: RegisterAgents): void {
  v.delete(
    "/:id",
    {
      ...guard("project:delete"),
      params: idParamsSchema,
      output: archiveResultSchema,
      description:
        "Archive an agent. It leaves the list and its runs stay. A connected agent that registers again restores its row.",
      docs: docsOf({ docs, operationId: "archiveAgent" }),
    },
    async (_c, { params, app }: { params: { id: string }; app: AgentsApp }) => {
      const agent = await app.agents.archiveAgent({
        id: params.id,
        projectId: app.project.id,
      });
      return {
        id: agent.id,
        name: agent.name,
        type: agentTypeSchema.parse(agent.type),
        archivedAt: agent.archivedAt,
      };
    },
  );
}

/** `POST /:id/test`, the one-off scripted run; only the `/api/v1` family. */
export function registerAgentTestEndpoint({
  v,
  guard,
}: {
  v: AgentsVersion;
  guard: AgentsGuard;
}): void {
  v.post(
    "/:id/test",
    {
      ...guard("scenarios:create"),
      params: idParamsSchema,
      output: agentTestRunResponseSchema,
      description:
        'Run one scripted scenario against an agent: the user sends "ping", the agent answers, and the run succeeds when the answer arrives. No model is used, and no scenario, run plan or test suite is added to the project. Answers at once with the run ids; the run itself is asynchronous.',
      docs: {
        operationId: "testAgent",
        tags: ["Agents"],
        responses: {
          403: {
            description:
              "The agent is a personal development agent of someone else",
          },
          404: { description: "No agent with that id in this project" },
          422: { description: "The agent cannot be tested as it is set up" },
        },
      },
    },
    async (c, { params, app }: { params: { id: string }; app: AgentsApp }) => {
      const run = await app.agents.testRun({
        projectId: app.project.id,
        agentId: params.id,
        actor: runActorOf(c),
      });
      return agentTestRunResponseSchema.parse(run);
    },
  );
}
