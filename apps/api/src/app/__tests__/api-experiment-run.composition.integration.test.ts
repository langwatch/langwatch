/**
 * The workbench run loop, composed for real and driven end to end.
 *
 * What this pins is the thing the packaged run loop cannot pin for itself: the
 * loop states its collaborators as one injected bag and this process is what
 * fills it, so until something drives a run over the FILLED bag, "an experiment
 * runs on the API" is an assertion about a type rather than about a process.
 *
 * Nothing between the call and the wire is stubbed. The orchestrator, the
 * polling runner, the cell-workflow builder, the studio dispatch and its
 * server-sent-event framing, the Redis progress adapter, the Experiment
 * service and its producer-only `experiment_run_processing` registration are
 * all the real ones. The doubles are exactly the four things this process does
 * not own in a test: the DATABASE, the model gateway, the QUEUE, and the NLP
 * engine — and the engine is doubled at `fetch`, one layer further out than the
 * port, so the dispatch adapter, the parameter strip and the frame decoder all
 * run for real.
 *
 * The three questions:
 *
 *   the namespaces still mount    the four experiments/workflow surfaces answer
 *                                 over the same composition that now carries a
 *                                 run loop, through the real `/api/trpc` handler
 *   a run reaches the engine      one cell is dispatched to the configured
 *                                 engine address, and the progress store holds
 *                                 the run from creation to completion
 *   no Redis refuses by name      the loop is absent rather than degraded, and
 *                                 says which capability is missing
 */
import type { AgentService, Agent as TypedAgent } from "@langwatch/agent-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type {
  AuthzGetDecisionInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { EventSourcing } from "@langwatch/eventing";
import type {
  EvaluationsV3State,
  ExecutionScope,
  TargetConfig,
} from "@langwatch/experiment-contract";
import { createInitialUIState } from "@langwatch/experiment-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiAuditPort } from "../../api-request.policy";
import { ApiApplication, MissingAgentService, MissingSecretService } from "../../api.application";
import { composeApiExecutionCollaborators } from "../api-trpc-collaborators.execution.composition";
import {
  ApiTrpcFeaturesComposition,
  composeApiTrpcCollaborators,
} from "../api-trpc-features.composition";
import { testHalves } from "./api-trpc-collaborators.test-halves";

const NLP_SERVICE_URL = "http://127.0.0.1:5561";
const PUBLIC_BASE_URL = "https://app.example.test";

/** A group whose members refuse by name if a call actually reaches them. */
function stub<T>(group: string, buildTime: Record<string, unknown> = {}): T {
  return new Proxy(buildTime, {
    get(target, property) {
      if (property in target) return target[property as string];
      return () => {
        throw new Error(`the test reached ${group}.${String(property)}, which it does not stub`);
      };
    },
    has: () => true,
  }) as T;
}

const experimentRow = {
  id: "experiment-1",
  projectId: "project-1",
  name: "Latency sweep",
  slug: "latency-sweep",
  type: "BATCH_EVALUATION_V2",
  workflowId: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  archivedAt: null,
  workbenchState: null,
  workbenchVersion: 0,
};

/**
 * The tables this run reads, and nothing else.
 *
 * The project row and its secrets are what the studio event preparation reads
 * to hand the engine the credentials a run executes with; the experiment list
 * is the tRPC read. Every other model answers a rejecting proxy, so a read the
 * run did not intend fails by name rather than resolving to `undefined`.
 */
function testPrisma() {
  const experimentFindMany = vi.fn(async () => [experimentRow]);
  const projectFindUniqueOrThrow = vi.fn(async () => ({ apiKey: "sk-lw-project-1" }));
  const projectSecretFindMany = vi.fn(async () => [] as Array<never>);

  const client = new Proxy(
    {
      experiment: { findMany: experimentFindMany },
      project: {
        findUniqueOrThrow: projectFindUniqueOrThrow,
        findUnique: async () => ({ team: { organizationId: "org-1" } }),
      },
      projectSecret: { findMany: projectSecretFindMany },
      agent: { findMany: async () => [] },
      evaluator: { findMany: async () => [] },
    },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return stub(`prisma.${String(property)}`);
      },
      has: () => true,
    },
  ) as unknown as PrismaClient;

  return { client, experimentFindMany, projectFindUniqueOrThrow };
}

/** Permits everything: the refusal path is the declared check's own suite. */
function testAuthz(): AuthzService {
  return {
    hasPermission: async () => true,
    getDecision: async (_input: AuthzGetDecisionInput): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    getProjectAnyDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    checkScopeLineage: async (): Promise<AuthzScopeLineageResult> => ({ kind: "consistent" }),
  } as unknown as AuthzService;
}

/** One registered definition and every command sent on it. */
type SentCommand = { name: string; data: unknown };

function testEventing() {
  const registered: Array<{ name: string; commands: readonly string[] }> = [];
  const sent: SentCommand[] = [];

  const eventing = {
    register(definition: {
      metadata: { name: string; commands: ReadonlyArray<{ name: string }> };
    }) {
      const names = definition.metadata.commands.map((command) => command.name);
      registered.push({ name: definition.metadata.name, commands: names });
      return {
        commands: Object.fromEntries(
          names.map((name) => [
            name,
            { send: async (data: unknown) => void sent.push({ name, data }) },
          ]),
        ),
      };
    },
  } as unknown as EventSourcing;

  return { eventing, registered, sent };
}

/**
 * The gateway, answering the three questions a run asks it: which providers a
 * project has (the dispatch's parameter strip), what a model costs (the cell's
 * price), and which cost rules the project wrote (none).
 */
function testModelProviders(): ModelProviderService {
  return {
    getExecutionProviders: async () => [],
    getForProject: async () => ({}),
    resolveModelForFeature: async () => ({ model: "openai/gpt-5-mini" }),
    prepareExecution: async () => ({}),
    listCosts: async () => [],
    estimateCost: () => 0,
  } as unknown as ModelProviderService;
}

/** Keys, values and their expiries, as ioredis writes them. */
function testRedis() {
  const store = new Map<string, string>();
  const connection = {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  } as unknown as RedisConnection;
  return { connection, store };
}

/** The one credential a run mints for the code it executes. */
function testApiKeys(): { service: ApiKeyService; created: unknown[] } {
  const created: unknown[] = [];
  const service = {
    create: async (input: unknown) => {
      created.push(input);
      return { token: "sk-lw-sandbox" };
    },
  } as unknown as ApiKeyService;
  return { service, created };
}

/**
 * One HTTP agent, which is the target a cell can run with no model and no
 * saved prompt: the graph it builds carries no LLM node, so what this exercises
 * is the dispatch rather than the gateway.
 */
const httpAgent = {
  id: "agent-1",
  projectId: "project-1",
  name: "Support triage",
  type: "http",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  config: {
    url: "https://agent.example.test/answer",
    method: "POST",
    outputPath: "answer",
  },
} as unknown as TypedAgent;

const target: TargetConfig = {
  id: "target-1",
  type: "agent",
  agentType: "http",
  dbAgentId: "agent-1",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {
    "dataset-1": {
      input: {
        type: "source",
        source: "dataset",
        sourceId: "dataset-1",
        sourceField: "question",
      },
    },
  },
} as unknown as TargetConfig;

const workbenchState: EvaluationsV3State = {
  name: "Latency sweep",
  datasets: [
    {
      id: "dataset-1",
      name: "Questions",
      type: "inline",
      inline: { columns: [], records: {} },
      columns: [{ id: "question", name: "question", type: "string" }],
    },
  ] as unknown as EvaluationsV3State["datasets"],
  activeDatasetId: "dataset-1",
  targets: [target],
  evaluators: [],
  results: {
    status: "idle",
    targetOutputs: {},
    targetMetadata: {},
    evaluatorResults: {},
    errors: {},
  },
  pendingSavedChanges: {},
  ui: createInitialUIState(),
};

/** One server-sent-event stream, as the engine answers a cell. */
function engineStream(frames: readonly unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      controller.close();
    },
  });
}

/** The two frames a successful cell produces: one node result, then `done`. */
const successFrames = [
  {
    type: "component_state_change",
    payload: {
      component_id: "target-1",
      execution_state: {
        status: "success",
        outputs: { output: "Reset your password from the account page." },
        cost: 0,
        timestamps: { started_at: 1, finished_at: 2 },
        trace_id: "0af7651916cd43dd8448eb211c80319c",
      },
    },
  },
  { type: "done" },
];

function composeApplication(options: { redis?: RedisConnection | null } = {}) {
  const prisma = testPrisma();
  const eventing = testEventing();
  const redis = options.redis === undefined ? testRedis() : null;
  const apiKeys = testApiKeys();

  const execution = composeApiExecutionCollaborators({
    prisma: prisma.client,
    processName: "langwatch-api-test",
    modelProviders: testModelProviders(),
    agents: stub<AgentService>("agents"),
    resolveClickHouseClient: null,
    nlpServiceUrl: NLP_SERVICE_URL,
    publicBaseUrl: PUBLIC_BASE_URL,
    secretDecryptor: { decrypt: (value) => `decrypted:${value}` },
    eventing: eventing.eventing,
    redis: redis?.connection ?? options.redis ?? null,
    apiKeys: apiKeys.service,
    environment: {},
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: prisma.client } as unknown as PrismaConnection,
    authz: testAuthz(),
    audit: new (class extends ApiAuditPort {
      async record(): Promise<void> {}
    })(),
    collaborators: composeApiTrpcCollaborators(testHalves({ execution })),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    agents: new MissingAgentService(),
    secrets: new MissingSecretService(),
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: "user-1" }),
        tryActor: () => ({ id: "user-1" }),
        authorize: async () => undefined,
        session: { user: { id: "user-1", email: "person@example.com" } },
      }),
      audit: async () => undefined,
    },
  });

  return { application, execution, prisma, eventing, redis, apiKeys };
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const response = await application.hono.request(
    `http://127.0.0.1/api/trpc/${path}?input=${encoded}`,
  );
  return { status: response.status, body: await response.json() };
}

/**
 * Waits for the run to reach a terminal state in the progress store.
 *
 * `startRun` answers as soon as the run is registered and leaves the loop
 * streaming in the background, which is the whole point of the polling API —
 * so the test polls the same store a caller would.
 */
async function awaitRunState(
  store: Map<string, string>,
  runId: string,
): Promise<{ status: string; total: number; progress: number; summary?: unknown }> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const raw = store.get(`eval_v3_run:${runId}`);
    if (raw) {
      const state = JSON.parse(raw) as { status: string; total: number; progress: number };
      if (state.status !== "running" && state.status !== "pending") return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the run ${runId} never left the running state`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("given the workbench run loop composed over this process's own graph", () => {
  it("mounts the four namespaces it shares a graph with, over the real /api/trpc handler", async () => {
    const { application, prisma } = composeApplication();

    const { status, body } = await callTrpc(application, "experiments.getAllByProjectId", {
      projectId: "project-1",
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      result: { data: { json: [{ id: "experiment-1", slug: "latency-sweep" }] } },
    });
    expect(prisma.experimentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: "project-1" }) }),
    );
  });

  it("registers the packaged experiment-run pipeline as a producer beside the evaluation one", () => {
    const { eventing } = composeApplication();

    const names = eventing.registered.map((entry) => entry.name);
    expect(names).toContain("experiment_run_processing");
    expect(names).toContain("evaluation_processing");
    // The whole definition, not a producer's subset: the routing triple a job
    // carries is derived from these names, and a fork would send commands the
    // worker's registry does not claim.
    const experimentRun = eventing.registered.find(
      (entry) => entry.name === "experiment_run_processing",
    );
    expect(experimentRun?.commands).toEqual(
      expect.arrayContaining([
        "startExperimentRun",
        "recordTargetResult",
        "recordEvaluatorResult",
        "computeExperimentRunMetrics",
        "completeExperimentRun",
      ]),
    );
  });

  describe("when a run is started over the composed ports", () => {
    it("dispatches the cell to the configured engine and records the run's progress", async () => {
      const fetchSpy = vi.fn(
        async () =>
          new Response(engineStream(successFrames), {
            headers: { "Content-Type": "text/event-stream" },
          }),
      );
      vi.stubGlobal("fetch", fetchSpy);

      const { execution, redis, eventing } = composeApplication();
      const run = execution.experimentRun;
      expect(run.ports).not.toBeNull();
      expect(run.progress).not.toBeNull();

      const started = await run.startRun({
        projectId: "project-1",
        projectSlug: "support",
        experimentId: "experiment-1",
        experimentSlug: "latency-sweep",
        state: workbenchState,
        datasetRows: [{ question: "How do I reset my password?" }],
        datasetColumns: [{ id: "question", name: "question", type: "string" }],
        loadedPrompts: new Map(),
        loadedAgents: new Map([["agent-1", httpAgent]]),
        scope: { type: "full" } as ExecutionScope,
      });

      expect(started.total).toBe(1);
      expect(started.runUrl).toBe(
        `${PUBLIC_BASE_URL}/support/experiments/latency-sweep?runId=${started.runId}`,
      );

      const state = await awaitRunState(redis!.store, started.runId);
      expect(state.status).toBe("completed");
      expect(state.total).toBe(1);

      // The cell reached the ENGINE this process was configured with, over the
      // packaged streaming route, tagged as an evaluation run.
      expect(fetchSpy).toHaveBeenCalled();
      const [url, request] = fetchSpy.mock.calls[0] as unknown as [
        string,
        { headers: Record<string, string>; body: string },
      ];
      expect(url).toBe(`${NLP_SERVICE_URL}/go/studio/execute`);
      // The transport header is the studio default, which is what the retired
      // application sent for a workbench cell too: the run says it is an
      // evaluation in the EVENT, and the dispatch option that would change the
      // header is one the loop deliberately leaves unset.
      expect(request.headers["X-LangWatch-Origin"]).toBe("workflow");
      const dispatched = JSON.parse(request.body) as {
        type: string;
        payload: {
          node_id: string;
          origin: string;
          workflow: { project_id: string; api_key: string };
        };
      };
      expect(dispatched.type).toBe("execute_component");
      expect(dispatched.payload.node_id).toBe("target-1");
      expect(dispatched.payload.origin).toBe("evaluation");
      // Prepared, not raw: the project's own credentials went with it, which is
      // what `prepareStudioEvent` is in the path for.
      expect(dispatched.payload.workflow.project_id).toBe("project-1");
      expect(dispatched.payload.workflow.api_key).toBe("sk-lw-project-1");

      // And the run's history was dispatched onto the producer registration.
      const started_ = eventing.sent.filter((command) => command.name === "startExperimentRun");
      expect(started_).toHaveLength(1);
      expect(started_[0]?.data).toMatchObject({
        tenantId: "project-1",
        runId: started.runId,
        experimentId: "experiment-1",
        total: 1,
      });
      expect(eventing.sent.map((command) => command.name)).toContain("completeExperimentRun");
    });
  });

  describe("when the process composed no Redis", () => {
    it("mounts every namespace and refuses to START a run, naming the progress store", async () => {
      const { application, execution } = composeApplication({ redis: null });

      const { status } = await callTrpc(application, "experiments.getAllByProjectId", {
        projectId: "project-1",
      });
      expect(status).toBe(200);

      expect(execution.experimentRun.ports).toBeNull();
      expect(execution.experimentRun.progress).toBeNull();

      const refusal = await execution.experimentRun
        .startRun({
          projectId: "project-1",
          projectSlug: "support",
          experimentId: "experiment-1",
          experimentSlug: "latency-sweep",
          state: workbenchState,
          datasetRows: [{ question: "How do I reset my password?" }],
          datasetColumns: [{ id: "question", name: "question", type: "string" }],
          loadedPrompts: new Map(),
          loadedAgents: new Map([["agent-1", httpAgent]]),
        })
        .then(() => null)
        .catch((error: unknown) => error);

      expect(HandledError.isHandled(refusal)).toBe(true);
      const handled = refusal as HandledError;
      expect(handled.code).toBe("service_unavailable");
      expect(handled.meta).toMatchObject({
        process: "langwatch-api-test",
        capability: expect.stringContaining("progress store"),
      });
    });
  });
});
