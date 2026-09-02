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
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService, ProjectWithTeam } from "@langwatch/project-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import { composeApiModelProviders } from "../api-model-provider.composition";
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

/**
 * A middleware that does nothing, for the custom checks a mount installs while
 * the record is being BUILT.
 */
const passThroughMiddleware = ({ next }: { next: () => unknown }) => next();

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
 * The project's configured default for the model a new Studio graph is built
 * with — one row, read back through the packaged Prisma repository.
 */
const modelDefaultRow = {
  id: "model_default_1",
  organizationId: "org-1",
  config: { "workflows.create_default": "openai/gpt-5-mini" },
  scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
  authorId: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

/** The version row a create writes, as the repository reads it back. */
const versionRow = {
  id: "version-1",
  projectId: "project-1",
  workflowId: "workflow-1",
  version: "1",
  commitMessage: "First commit",
  autoSaved: false,
  dsl: {},
  parentId: null,
  authorId: "user-1",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

/**
 * The tables this composition reads in these calls, and nothing
 * else.
 *
 * Every other model answers a rejecting proxy, so a read the test did not
 * intend fails by name instead of quietly resolving to `undefined`.
 */
function testPrisma(options: { modelDefaults?: readonly unknown[] } = {}) {
  const workflowFindFirst = vi.fn(async () => workflowRow);
  const experimentFindMany = vi.fn(async () => [experimentRow]);
  const modelDefaultFindMany = vi.fn(async () => [...(options.modelDefaults ?? [modelDefaultRow])]);
  const workflowCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...workflowRow,
    ...data,
  }));
  const workflowUpdate = vi.fn(async () => workflowRow);
  const savedVersions: Array<Record<string, unknown>> = [];
  const workflowVersionCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    savedVersions.push(data);
    return { ...versionRow, ...data };
  });

  const client = new Proxy(
    {
      workflow: {
        findFirst: workflowFindFirst,
        findMany: async () => [],
        create: workflowCreate,
        update: workflowUpdate,
      },
      workflowVersion: {
        create: workflowVersionCreate,
        findFirst: async () => null,
        findMany: async () => [],
      },
      experiment: { findMany: experimentFindMany },
      modelDefaultConfig: { findMany: modelDefaultFindMany },
    },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return stub(`prisma.${String(property)}`);
      },
      // A repository may ASK for its delegates before it uses them — the model
      // provider one refuses a client with no `modelProvider` rather than
      // failing on the first read — so presence has to agree with the getter:
      // every model exists, and reaching one this file did not describe still
      // fails by name.
      has: () => true,
    },
  ) as unknown as PrismaClient;

  return {
    client,
    workflowFindFirst,
    experimentFindMany,
    modelDefaultFindMany,
    workflowCreate,
    savedVersions,
  };
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
    batchRecord: stub("batchRecord"),
    auth: testAuthApp(),
    bugReports: stub("bugReports"),
    dataPrivacy: stub("dataPrivacy"),
    dataset: stub("dataset"),
    evaluators: stub("evaluators"),
    evaluations: stub("evaluations", { mappingsSchema: anySchema }),
    experiments: stub("experiments", { workbenchStateSchema: anySchema }),
    graphs: stub("graphs", { filterFieldSchema: anySchema }),
    group: stub("group"),
    home: stub("home"),
    identity: stub("identity"),
    integrationsChecks: stub("integrationsChecks"),
    joinRequests: stub("joinRequests"),
    onboarding: stub("onboarding", { signUpDataSchema: anySchema }),
    prompts: stub("prompts"),
    role: stub("role", { customRolePermission: anySchema }),
    team: stub("team"),
    // The three product-infrastructure surfaces, as one entry. Only the
    // monitor precondition parser is read while the record is BUILT; the
    // retention policy and the rest refuse by name if a call reaches them.
    productInfra: {
      dataRetention: stub("productInfra.dataRetention"),
      monitors: stub("productInfra.monitors", { preconditionsSchema: anySchema }),
    },
    /**
     * The trace group, stubbed with only what the record reads while it is
     * being BUILT: the input schemas its procedures are parsed with, and the
     * two custom checks its model-provider mount wraps a procedure in. Its own
     * suite is what proves it answers.
     */
    /**
     * The nine tenant-administration surfaces, stubbed with only what the
     * record reads while it is BUILT: the sign-up questionnaire the
     * organization ceremony parses against, and the three data-dependent
     * gates the mounts chain onto a procedure. Its own suite is what proves it
     * answers.
     */
    orgGroup: {
      organization: stub("orgGroup.organization", {
        signUpDataSchema: anySchema,
        isCustomRole: () => false,
      }),
      organizationAuditLogCheck: passThroughMiddleware,
      project: stub("orgGroup.project"),
      projectChecks: {
        create: passThroughMiddleware,
        traceSharing: passThroughMiddleware,
      },
      codingAgents: stub("orgGroup.codingAgents"),
      automation: stub("orgGroup.automation", {
        providers: stub("orgGroup.automation.providers"),
      }),
      emailSuppression: stub("orgGroup.emailSuppression"),
      enterprise: {
        scimToken: stub("orgGroup.enterprise.scimToken"),
        ssoConnections: stub("orgGroup.enterprise.ssoConnections"),
      },
    },
    traceGroup: {
      traces: stub("traceGroup.traces", {
        listInputSchema: anySchema,
        filterInputSchema: anySchema,
        evaluatorTypeSchema: anySchema,
        preconditionSchema: anySchema,
      }),
      tracesV2: stub("traceGroup.tracesV2", { traceMetadataUpdateSchema: anySchema }),
      spans: stub("traceGroup.spans"),
      traceEditOverlay: stub("traceGroup.traceEditOverlay"),
      sharedTrace: stub("traceGroup.sharedTrace"),
      savedViews: stub("traceGroup.savedViews"),
      costs: stub("traceGroup.costs"),
      llmModelCost: stub("traceGroup.llmModelCost"),
      modelProvider: stub("traceGroup.modelProvider"),
      modelProviderChecks: {
        tenantWrite: () => passThroughMiddleware,
        credentialProbe: passThroughMiddleware,
      },
      translate: stub("traceGroup.translate"),
      httpProxy: stub("traceGroup.httpProxy"),
      limits: stub("traceGroup.limits"),
    },
    /**
     * The six agent surfaces, stubbed with only what the record reads while it
     * is being BUILT. Their own suite is what proves they answer.
     */
    agentGroup: {
      scenarios: stub("agentGroup.scenarios"),
      langy: stub("agentGroup.langy"),
      langyGates: {
        refuseDemoProject: passThroughMiddleware,
        enforceLangyAccess: passThroughMiddleware,
      },
      langyEgress: stub("agentGroup.langyEgress"),
      ops: stub("agentGroup.ops"),
      opsCheck: () => passThroughMiddleware,
    },
    user: stub("user"),
    workflows: {
      lifecycle: stub("workflows.lifecycle"),
      optimization: stub("workflows.optimization"),
    },
  } as unknown as AnyApiTrpcCollaborators;
}

/**
 * A Studio graph whose one LLM node names no model — the shape that makes the
 * create path ask the gateway rather than take the client's word for it.
 */
const modellessDsl = {
  spec_version: "1.5",
  name: "Support triage",
  icon: "🧭",
  description: "",
  version: "1",
  template_adapter: "default" as const,
  enable_tracing: true,
  state: {},
  nodes: [
    {
      id: "llm_call",
      type: "signature",
      position: { x: 0, y: 0 },
      data: { parameters: [{ identifier: "llm", type: "llm", value: null }] },
    },
  ],
  edges: [],
};

const evaluationOutcome = {
  status: "processed" as const,
  score: 0.82,
  passed: true,
  label: null,
  details: null,
};

/**
 * The project and organization reads the model gateway derives a scope chain
 * from: a default set on the project, its team or its organization.
 */
function testProjects(): ProjectService {
  const project = {
    id: "project-1",
    name: "Support",
    slug: "support",
    teamId: "team-1",
    team: { id: "team-1", name: "Core", organizationId: "org-1" },
  } as unknown as ProjectWithTeam;

  return {
    getWithTeam: async () => project,
    tryGetWithTeam: async () => project,
  } as unknown as ProjectService;
}

function testOrganizations(): OrganizationService {
  return {
    getBillingProfile: async () => ({ id: "org-1", name: "LangWatch" }),
  } as unknown as OrganizationService;
}

/**
 * The stored-secret cipher, with the deployment's key replaced by a marker.
 *
 * A real AES key would prove nothing extra here: what the gateway needs from
 * this port is that a credential column round-trips, and the algorithm has its
 * own suite in `@langwatch/secret-server`.
 */
function testCipher(): SecretEncryptionPort {
  return {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => {
      if (!value.startsWith("enc:")) throw new Error("Invalid encrypted string format");
      return value.slice("enc:".length);
    },
  } as SecretEncryptionPort;
}

/**
 * The REAL model gateway, composed the way the production root composes it.
 *
 * Not a double: `composeApiModelProviders` builds the packaged service over
 * the packaged Prisma repositories, the moved catalogue, the moved credential
 * codec and the moved connection limiter. The fakes are at the PORTS this
 * process owns — the database, the project and organization reads, the cipher
 * and the counter — which is exactly the seam the composition draws.
 */
function testModelGateway(prisma: PrismaClient) {
  return composeApiModelProviders({
    prisma,
    projects: testProjects(),
    organizations: testOrganizations(),
    authorization: testAuthz(),
    encryption: testCipher(),
    rateLimit: async () => ({ allowed: true, remaining: 19, resetAt: Date.now() + 60_000 }),
    environment: {},
    isSaas: false,
    egress: { blockLocal: true, allowedHosts: [], verifyTls: true },
    nlpServiceUrl: "http://127.0.0.1:5561",
    processName: "langwatch-api-test",
  });
}

function composeApplication(
  options: {
    eventing?: boolean;
    realModelGateway?: boolean;
    modelDefaults?: readonly unknown[];
  } = {},
) {
  const prisma = testPrisma({ modelDefaults: options.modelDefaults });
  const clickhouse = testClickHouse();
  const eventing = testEventing();
  const runEvaluationForTrace = vi.fn(async () => evaluationOutcome);
  const trackEvaluationRan = vi.fn();

  const execution = composeApiExecutionCollaborators({
    prisma: prisma.client,
    processName: "langwatch-api-test",
    modelProviders: options.realModelGateway
      ? testModelGateway(prisma.client)
      : testModelProviders(),
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

  describe("when a workflow is created through the real /api/trpc handler", () => {
    /**
     * The whole point of this file, one call deeper.
     *
     * `workflow.create` prepares the graph before it writes it, and preparing
     * a graph whose LLM node names no model is what asks the MODEL GATEWAY
     * which model this project uses. Nothing on that path is stubbed here: the
     * gateway is `composeApiModelProviders`, the resolution is the packaged
     * cascade, and the default it reads is a row the packaged Prisma
     * repository fetched. Before this composition existed the gateway arrived
     * as a host option nobody supplied, so this procedure could not run at all.
     */
    it("resolves the project's default model through the real gateway", async () => {
      const { application, prisma } = composeApplication({ realModelGateway: true });

      const { status } = await mutateTrpc(application, "workflow.create", {
        projectId: "project-1",
        dsl: modellessDsl,
        commitMessage: "First commit",
      });

      expect(status).toBe(200);
      // The row was read at the ORGANIZATION scope the project's team resolves
      // to, which is the chain the cascade walks — a resolution that skipped it
      // would answer from the registry flagship and look identical here.
      expect(prisma.modelDefaultFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: "org-1" } }),
      );
      // And the model it resolved is on the node that had none, which is what
      // the run would have executed with.
      const written = prisma.savedVersions[0]?.dsl as
        | { nodes: Array<{ data: { parameters: Array<{ value: unknown }> } }> }
        | undefined;
      expect(written?.nodes[0]?.data.parameters[0]?.value).toMatchObject({
        model: "openai/gpt-5-mini",
      });
    });

    /**
     * The discriminator for the assertion above.
     *
     * With no configured default the cascade raises "nothing is configured at
     * any scope" and the studio adapter falls back to the registry flagship,
     * so the two cases answer with different models — which is what makes the
     * first one evidence that the row was read rather than a coincidence.
     */
    it("falls back to the registry flagship when the project configured none", async () => {
      const { application, prisma } = composeApplication({
        realModelGateway: true,
        modelDefaults: [],
      });

      const { status } = await mutateTrpc(application, "workflow.create", {
        projectId: "project-1",
        dsl: modellessDsl,
        commitMessage: "First commit",
      });

      expect(status).toBe(200);
      const written = prisma.savedVersions[0]?.dsl as
        | { nodes: Array<{ data: { parameters: Array<{ value: { model: string } }> } }> }
        | undefined;
      const resolved = written?.nodes[0]?.data.parameters[0]?.value.model;
      expect(resolved).toBeDefined();
      expect(resolved).not.toBe("openai/gpt-5-mini");
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
