/**
 * The execution half of the collaborator set, composed for real and driven
 * over the real `/api/trpc` handler.
 *
 * What this pins is what the record was missing: `trpcCollaborators` is a typed
 * obligation, and until something satisfies it every one of the twenty-two
 * namespaces is absent in production. The three calls here are the three
 * things this composition answers, and none of them is stubbed on the way down
 * — the applications, the services, the repositories and the packaged
 * transports are the real ones, and only the two DATABASES, the model gateway
 * and the command QUEUE are doubles.
 *
 *   workflow.getById              the studio's read, from the packaged
 *                                 transport through `WorkflowApp`,
 *                                 `WorkflowService` and the Prisma repository.
 *   experiments.getAllByProjectId `ExperimentApp` over the packaged Postgres
 *                                 adapter — the second application this half
 *                                 composes, over the SAME workflow service.
 *   evaluations.runEvaluation     the re-score, whose result is reported onto
 *                                 the `evaluation_processing` pipeline through
 *                                 a PRODUCER-only registration of the same
 *                                 packaged definition the worker drains.
 *
 * A fake queue rather than a Redis: what is under test is the COMPOSITION —
 * that the definition registered is the packaged one, that its
 * `reportEvaluation` sender is the one the tRPC call reaches, and that the
 * payload arrives whole. The pipeline's own behaviour has its suites in
 * `@langwatch/evaluation-server`.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { AuthApp } from "@langwatch/auth-server";
import type {
  AuthzGetDecisionInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { AgentService } from "@langwatch/agent-contract";
import type { EventSourcing } from "@langwatch/eventing";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiAuditPort } from "../../api-request.policy";
import { ApiApplication } from "../../api.application";
import type { AnyApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import {
  composeApiExecutionCollaborators,
  withApiExecutionCollaborators,
} from "../api-trpc-collaborators.execution.composition";
import { ApiTrpcFeaturesComposition } from "../api-trpc-features.composition";

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

const anySchema = z.any();
const openGate = <TProcedure>(procedure: TProcedure): TProcedure => procedure;

const workflowRow = {
  id: "workflow-1",
  projectId: "project-1",
  name: "Support triage",
  icon: "🧭",
  description: "",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  archivedAt: null,
  isEvaluator: false,
  isComponent: false,
  latestVersionId: null,
  currentVersionId: null,
  publishedId: null,
  publishedById: null,
  copiedFromWorkflowId: null,
  currentVersion: null,
  latestVersion: null,
};

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
 * The two tables this composition reads in these three calls, and nothing
 * else.
 *
 * Every other model answers a rejecting proxy, so a read the test did not
 * intend fails by name instead of quietly resolving to `undefined`.
 */
function testPrisma() {
  const workflowFindFirst = vi.fn(async () => workflowRow);
  const experimentFindMany = vi.fn(async () => [experimentRow]);

  const client = new Proxy(
    {
      workflow: { findFirst: workflowFindFirst, findMany: async () => [] },
      experiment: { findMany: experimentFindMany },
    },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return stub(`prisma.${String(property)}`);
      },
    },
  ) as unknown as PrismaClient;

  return { client, workflowFindFirst, experimentFindMany };
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

/**
 * The producer side of the queue, recorded.
 *
 * `register` keeps the definition rather than discarding it, because half of
 * what this proves is that the definition handed over is the PACKAGED one: a
 * fork declaring only the commands a producer sends would route to names the
 * worker does not claim.
 */
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

/** The model gateway, answering the one shape a Studio graph asks it for. */
function testModelProviders(): ModelProviderService {
  return {
    getExecutionProviders: async () => [],
    resolveModelForFeature: async () => ({ model: "openai/gpt-5-mini" }),
    prepareExecution: async () => ({}),
  } as unknown as ModelProviderService;
}

function testAgents(): AgentService {
  return stub<AgentService>("agents");
}

function testClickHouse() {
  const issued: Array<{ tenantId: string; query: string }> = [];
  const resolveClient = (tenantId: string): Promise<ClickHouseClient> =>
    Promise.resolve({
      query: (input: { query: string }) => {
        issued.push({ tenantId, query: input.query });
        return Promise.resolve({ json: () => Promise.resolve([]) });
      },
    } as unknown as ClickHouseClient);
  return { issued, resolveClient };
}

function testAuthApp(): AuthApp {
  return AuthApp.create({
    clientIp: () => "127.0.0.1",
    rateLimit: async () => ({ allowed: true }),
    route: async () => ({ kind: "password" }) as never,
    addressIsRegistered: async () => false,
    requestSignUpVerification: async () => undefined,
    completeSignUpVerification: async () => ({
      email: "person@example.com",
      accountCreated: true,
      accountExists: false,
    }),
    readInviteLanding: async () => ({
      organizationName: "LangWatch",
      inviterName: null,
      alreadyAccepted: false,
    }),
    requestFreshInvite: async () => undefined,
    resolveAuthProvider: async () => "email",
  });
}

/**
 * Every collaborator the record needs EXCEPT the execution half, stubbed.
 *
 * The fold under test replaces six of these entries — the three port groups
 * and the three application slices — so what is left stubbed is exactly what
 * this composition does not own.
 */
function otherCollaborators(): AnyApiTrpcCollaborators {
  return {
    application: {
      ...stub<ApiTrpcFeatureApplication>("app"),
      ops: { isAdmin: () => true },
      config: { opsSidebarEmails: [] },
    },
    analytics: {
      reads: stub("analytics.reads", {
        timeseriesInputSchema: anySchema,
        sharedFiltersSchema: anySchema,
        filterFieldSchema: anySchema,
      }),
      workbench: stub("analytics.workbench", {
        requireWorkbenchEnabled: openGate,
        maxStatementLength: 4_000,
        timeWindowSchema: anySchema,
        granularityStepSchema: anySchema,
      }),
      savedCharts: stub("analytics.savedCharts", {
        requireWorkbenchEnabled: openGate,
        timeWindowSchema: anySchema,
        granularityStepSchema: anySchema,
      }),
    },
    annotation: stub("annotation"),
    auth: testAuthApp(),
    bugReports: stub("bugReports"),
    dataPrivacy: stub("dataPrivacy"),
    evaluations: stub("evaluations", { mappingsSchema: anySchema }),
    experiments: stub("experiments", { workbenchStateSchema: anySchema }),
    graphs: stub("graphs", { filterFieldSchema: anySchema }),
    group: stub("group"),
    identity: stub("identity"),
    integrationsChecks: stub("integrationsChecks"),
    joinRequests: stub("joinRequests"),
    onboarding: stub("onboarding", { signUpDataSchema: anySchema }),
    user: stub("user"),
    workflows: {
      lifecycle: stub("workflows.lifecycle"),
      optimization: stub("workflows.optimization"),
    },
  } as unknown as AnyApiTrpcCollaborators;
}

const evaluationOutcome = {
  status: "processed" as const,
  score: 0.82,
  passed: true,
  label: null,
  details: null,
};

function composeApplication(options: { eventing?: boolean } = {}) {
  const prisma = testPrisma();
  const clickhouse = testClickHouse();
  const eventing = testEventing();
  const runEvaluationForTrace = vi.fn(async () => evaluationOutcome);
  const trackEvaluationRan = vi.fn();

  const execution = composeApiExecutionCollaborators({
    prisma: prisma.client,
    processName: "langwatch-api-test",
    modelProviders: testModelProviders(),
    agents: testAgents(),
    resolveClickHouseClient: clickhouse.resolveClient,
    nlpServiceUrl: "http://127.0.0.1:5561",
    publicBaseUrl: "https://app.example.test",
    secretDecryptor: { decrypt: (value) => `decrypted:${value}` },
    eventing: options.eventing === false ? undefined : eventing.eventing,
    runEvaluationForTrace: runEvaluationForTrace as never,
    trackEvaluationRan,
    environment: {},
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: prisma.client } as unknown as PrismaConnection,
    authz: testAuthz(),
    audit: new (class extends ApiAuditPort {
      async record(): Promise<void> {}
    })(),
    collaborators: withApiExecutionCollaborators(otherCollaborators(), execution),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
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

  return {
    application,
    execution,
    prisma,
    eventing,
    runEvaluationForTrace,
    trackEvaluationRan,
  };
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

async function mutateTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const response = await application.hono.request(`http://127.0.0.1/api/trpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  return { status: response.status, body: await response.json() };
}

describe("given the execution collaborators composed over this process's own graph", () => {
  it("satisfies the record's typed obligation, so the namespaces mount", () => {
    const { application } = composeApplication();

    const mounted = Object.keys(
      (application.trpc as unknown as { _def: { record: Record<string, unknown> } })._def.record,
    );

    expect(mounted).toContain("workflow");
    expect(mounted).toContain("optimization");
    expect(mounted).toContain("experiments");
    expect(mounted).toContain("evaluations");
  });

  describe("when a workflow read is called through the real /api/trpc handler", () => {
    it("answers from the real WorkflowApp over the packaged Prisma repository", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "workflow.getById", {
        projectId: "project-1",
        workflowId: "workflow-1",
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { id: "workflow-1", name: "Support triage" } } },
      });
      // The project id is in the WHERE clause, not only in the input: a
      // workflow read that resolved by id alone would cross tenants.
      expect(prisma.workflowFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "workflow-1", projectId: "project-1" }),
        }),
      );
    });
  });

  describe("when an experiments read is called through the real /api/trpc handler", () => {
    it("answers from the real ExperimentApp over the packaged Postgres adapter", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "experiments.getAllByProjectId", {
        projectId: "project-1",
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: [{ id: "experiment-1", slug: "latency-sweep" }] } },
      });
      expect(prisma.experimentFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: "project-1" }),
        }),
      );
    });
  });

  describe("when a trace is re-scored through the real /api/trpc handler", () => {
    it("registers the packaged evaluation pipeline as a producer", () => {
      const { eventing } = composeApplication();

      expect(eventing.registered).toHaveLength(1);
      expect(eventing.registered[0]?.name).toBe("evaluation_processing");
      // The whole definition, not a producer's subset: the routing triple a job
      // carries is derived from these names, and a fork would send commands the
      // worker's registry does not claim.
      expect(eventing.registered[0]?.commands).toEqual(
        expect.arrayContaining([
          "executeEvaluation",
          "startEvaluation",
          "completeEvaluation",
          "reportEvaluation",
        ]),
      );
    });

    it("reports the result onto the pipeline with the score the evaluator returned", async () => {
      const { application, eventing, runEvaluationForTrace, trackEvaluationRan } =
        composeApplication();

      const { status } = await mutateTrpc(application, "evaluations.runEvaluation", {
        projectId: "project-1",
        traceId: "trace-1",
        evaluatorType: "custom/evaluator-1",
        settings: {},
        mappings: null,
      });

      expect(status).toBe(200);
      expect(runEvaluationForTrace).toHaveBeenCalledTimes(1);
      expect(trackEvaluationRan).toHaveBeenCalledWith({
        userId: "user-1",
        projectId: "project-1",
      });
      expect(eventing.sent).toHaveLength(1);
      expect(eventing.sent[0]?.name).toBe("reportEvaluation");
      expect(eventing.sent[0]?.data).toMatchObject({
        tenantId: "project-1",
        traceId: "trace-1",
        evaluatorId: "custom/evaluator-1",
        status: "processed",
        score: 0.82,
        passed: true,
      });
    });
  });

  describe("when the process composed no command queue", () => {
    it("still mounts the namespaces, and reporting an evaluation refuses at the call", async () => {
      const { application, eventing } = composeApplication({ eventing: false });

      const { status } = await mutateTrpc(application, "evaluations.runEvaluation", {
        projectId: "project-1",
        traceId: "trace-1",
        evaluatorType: "custom/evaluator-1",
        settings: {},
        mappings: null,
      });

      // The re-score itself still answers: the pipeline report is a follow-up
      // the transport logs rather than a failure of the call.
      expect(status).toBe(200);
      expect(eventing.sent).toHaveLength(0);
    });
  });
});
