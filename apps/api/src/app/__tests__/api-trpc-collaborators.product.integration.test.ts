/**
 * The product half of the packaged tRPC record, served by the API process.
 *
 * What this pins is the seam the migration turns on for a project's own
 * content: `composeApiProductCollaborators` folded into the record's
 * collaborator set, built on THIS process's root, with THIS process's policy
 * chain, reachable over the real `/api/trpc` handler — and over the real
 * `/api/sse` lane for a subscription.
 *
 * Four calls, and none of them is a stub reached through a proxy:
 *
 *   dataPrivacy.getSnapshot  the whole read model moved into
 *                            `@langwatch/data-privacy-server`: the cascade's
 *                            two baselines, the RBAC filter over the rule list,
 *                            and the writable scopes the chip picker offers.
 *   annotation.createQueueItem  the queueing path, including the answer that is
 *                            trace storage's rather than Annotation's — which
 *                            of the ids sent address a trace this project holds.
 *   bugReports.getAll        the support inbox over the repository moved into
 *                            `@langwatch/ops-server`, with the audit row the
 *                            read is written to.
 *   export.onExportProgress  a SUBSCRIPTION in the record, resolved over the
 *                            SSE lane on the SAME root `/api/trpc` serves.
 *
 * And the seal, twice over: a complete collaborator set mounts every namespace
 * the record declares, and a set any half left unfilled composes NOTHING and
 * names what is missing — which is what keeps "the record did not mount" from
 * being a symptom nobody can act on.
 */
import type { AuthzCanBatchByIdsInput, AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ModelCostProjectPort } from "@langwatch/model-provider-server";
import { PostgresModelProviderEvidenceAdapter } from "@langwatch/model-provider-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { UserService } from "@langwatch/user-contract";
import { EventEmitter } from "node:events";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiApplication } from "../../api.application";
import { ApiAuditPort } from "../../api-request.policy";
import { ApiRestSecurity } from "../../api-rest.security";
import type { AnyApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import { createSseSubscriptionApp } from "../../app-trpc/app-trpc.sse";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition";
import { ApiTrpcFeaturesComposition } from "../api-trpc-features.composition";
import {
  ApiTrpcCollaboratorGapReport,
  composeApiProductCollaborators,
  sealApiTrpcCollaborators,
  withApiProductCollaborators,
  type ApiModelProviderEvidencePort,
} from "../api-trpc-collaborators.product.composition";

/**
 * A collaborator group with only the members the record reads while it is being
 * BUILT — the input schemas, and the one decorator a rollout gate applies to a
 * procedure. Everything else answers a function that refuses by name when a
 * call actually reaches it.
 */
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

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";

/** Every namespace `createAppTrpcFeatures` mounts, as the wire names them. */
const RECORD_NAMESPACES = [
  "activityMonitor",
  "aiTools",
  "analytics",
  "annotation",
  "annotationScore",
  "anomalyRules",
  "apiKey",
  "authz",
  "automation",
  "batchRecord",
  "bugReports",
  "codingAgents",
  "costs",
  "currency",
  "dashboards",
  "dataPrivacy",
  "dataRetention",
  "dataset",
  "datasetRecord",
  "departments",
  "emailSuppression",
  "evaluations",
  "evaluators",
  "experiments",
  "export",
  "featureFlag",
  "frontDoor",
  "gatewayBudgets",
  "gatewayCacheRules",
  "gatewayGuardrails",
  "gatewaySpendEvents",
  "gatewayUsage",
  "github",
  "governance",
  "graphs",
  "group",
  "home",
  "httpProxy",
  "identity",
  "ingestionKey",
  "ingestionSources",
  "ingestionTemplates",
  "integrationsChecks",
  "joinRequests",
  "langy",
  "langyEgress",
  "license",
  "licenseEnforcement",
  "limits",
  "llmModelCost",
  "modelProvider",
  "monitors",
  "onboarding",
  "ops",
  "optimization",
  "organization",
  "personalSessions",
  "personalVirtualKeys",
  "personalWorkspaceFeatures",
  "pinnedTrace",
  "plan",
  "presence",
  "project",
  "promptTags",
  "prompts",
  "publicEnv",
  "role",
  "roleBinding",
  "routingPolicy",
  "savedViews",
  "scenarios",
  "scimToken",
  "sessionPolicy",
  "setupSkills",
  "share",
  "sharedTrace",
  "spans",
  "ssoConnections",
  "storedObjects",
  "subscription",
  "suites",
  "team",
  "topics",
  "traceEditOverlay",
  "traces",
  "tracesV2",
  "translate",
  "user",
  "virtualKeys",
  "webhookEndpoints",
  "workflow",
] as const;

/**
 * The rows the product half reads, recorded.
 *
 * A double rather than a database, and the assertions are on the READS and the
 * WRITES rather than only on the returned object, because what the move has to
 * preserve is which rows are touched: the privacy snapshot's five directory
 * reads, and the one `createMany` a queued trace produces.
 */
function testPrisma() {
  const queueItemWrites: Array<Record<string, unknown>[]> = [];

  const transaction = {
    annotationQueueItem: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        queueItemWrites.push(data);
        return { count: data.length };
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    annotationQueueItemUser: {
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  const client = {
    $transaction: vi.fn(async (run: (tx: typeof transaction) => Promise<unknown>) =>
      typeof run === "function" ? await run(transaction) : undefined,
    ),
    project: {
      // Two callers with two shapes: the privacy directory reads a lineage by
      // `select`, the setup checklist reads the whole rollup by `include`.
      findUnique: vi.fn(
        async ({
          select,
          include,
        }: {
          select?: Record<string, unknown>;
          include?: Record<string, unknown>;
        }) => {
          if (include) {
            return {
              id: PROJECT_ID,
              name: "Acme production",
              teamId: TEAM_ID,
              firstMessage: true,
              integrated: false,
              workflows: [{ id: "workflow-1" }],
              customGraphs: [],
              datasets: [],
              checks: [],
              triggers: [],
              team: {
                organizationId: ORGANIZATION_ID,
                members: [{ userId: SESSION_USER.id }, { userId: "user-2" }],
              },
            };
          }
          return select && "teamId" in select
            ? {
                id: PROJECT_ID,
                name: "Acme production",
                teamId: TEAM_ID,
                team: { organizationId: ORGANIZATION_ID, organization: { name: "Acme" } },
              }
            : null;
        },
      ),
      findMany: vi.fn(async () => [
        { id: PROJECT_ID, name: "Acme production", teamId: TEAM_ID },
        { id: "project-2", name: "Acme staging", teamId: TEAM_ID },
      ]),
    },
    team: {
      findMany: vi.fn(async () => [{ id: TEAM_ID, name: "Platform" }]),
      findUnique: vi.fn(async () => ({ organizationId: ORGANIZATION_ID })),
    },
    department: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
    group: { findMany: vi.fn(async () => [{ id: "group-1", name: "Auditors" }]) },
    organization: { findUnique: vi.fn(async () => ({ id: ORGANIZATION_ID })) },
    dataPrivacyPolicy: {
      findMany: vi.fn(async () => [
        {
          id: "policy-org",
          organizationId: ORGANIZATION_ID,
          scopeType: "ORGANIZATION",
          scopeId: ORGANIZATION_ID,
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" } } },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "policy-project",
          organizationId: ORGANIZATION_ID,
          scopeType: "PROJECT",
          scopeId: PROJECT_ID,
          personalOnly: false,
          config: { categories: { output: { disposition: "drop" } } },
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    },
    annotationQueue: { count: vi.fn(async () => 1) },
    // The provider step is NOT this connection's to answer. Every access to
    // the delegate refuses — a property read, not only a call — so a
    // composition that reaches for `prisma.modelProvider` at all fails here
    // rather than quietly reading a table whose credential column it has no
    // rules for.
    modelProvider: new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(
            `the checklist reached prisma.modelProvider.${String(property)}; the provider step is the model-provider feature's read`,
          );
        },
      },
    ),
    // The checklist's own probe beyond the project: a prompt with a version.
    llmPromptConfig: { findFirst: vi.fn(async () => null) },
    bugReport: {
      findMany: vi.fn(async () => [{ id: "bugreport_1", title: "CLI cannot reach the API" }]),
      count: vi.fn(async () => 1),
    },
  } as unknown as PrismaClient;

  return { client, queueItemWrites, transaction };
}

/**
 * Permits the organization but NOT the second project, so the RBAC filter over
 * the snapshot is observable rather than assumed: a filter that permitted
 * everything would pass whether it ran or not.
 */
function testAuthz(): AuthzService {
  return {
    hasPermission: async () => true,
    canBatchByIds: async (input: AuthzCanBatchByIdsInput) => ({
      teams: new Map(input.teams.map((team) => [team.teamId, true])),
      projects: new Map(
        input.projects.map((project) => [project.projectId, project.projectId === PROJECT_ID]),
      ),
      organizationRole: null,
    }),
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  } as unknown as AuthzService;
}

/** The one statement shape the trace-existence read issues. */
type TraceExistenceQuery = Readonly<{
  query: string;
  query_params: Readonly<{ tenantId: string; traceIds: string[] }>;
}>;

/** ClickHouse holding exactly one of the two ids the caller will send. */
function testClickHouse(existing: readonly string[]) {
  const query = vi.fn(async (_statement: TraceExistenceQuery) => ({
    json: async () => existing.map((TraceId) => ({ TraceId })),
  }));
  return {
    query,
    resolveClient: async () => ({ query }) as never,
  };
}

class RecordingAudit extends ApiAuditPort {
  readonly entries: Array<{ path: string; input: unknown }> = [];

  async record(event: unknown): Promise<void> {
    this.entries.push(event as { path: string; input: unknown });
  }
}

/**
 * The rest of the record, stubbed: this file describes the product half, and a
 * namespace it does not own answering a call would mean the test had wandered.
 * The two application slices below are real, because two of the calls read
 * them: the operator check behind the support inbox, and the tenant emitter the
 * export relay watches.
 */
function baseCollaborators(broadcast: EventEmitter): AnyApiTrpcCollaborators {
  return {
    // Named one slice at a time rather than proxied: the folds SPREAD this
    // object, and a proxy's own keys are only the ones it was seeded with — so
    // a proxied application would collapse to those on the first fold and the
    // completeness seal would report the rest missing.
    application: {
      ops: { isAdmin: () => true },
      broadcast: {
        getTenantEmitter: () => broadcast,
        cleanupTenantEmitter: () => undefined,
      },
      analytics: stub("app.analytics"),
      apiKeys: stub("app.apiKeys"),
      authzApp: stub("app.authzApp"),
      config: {},
      dashboard: stub("app.dashboard"),
      dataset: stub("app.dataset"),
      evaluations: stub("app.evaluations"),
      evaluatorApp: stub("app.evaluatorApp"),
      experiments: stub("app.experiments"),
      featureFlags: stub("app.featureFlags"),
      organizations: stub("app.organizations"),
      permissions: stub("app.permissions"),
      presence: stub("app.presence"),
      projects: stub("app.projects"),
      prompts: stub("app.prompts"),
      roles: stub("app.roles"),
      users: stub("app.users"),
      monitors: stub("app.monitors"),
      // The four slices the agent half writes. Its own suite is what proves
      // they answer; here they only have to be present, because the seal
      // refuses a set any fold left unfilled.
      langy: stub("app.langy"),
      scenarios: stub("app.scenarios"),
      suites: stub("app.suites"),
      storedObjectApp: stub("app.storedObjectApp"),
      // The six slices the org-group half writes, present for the same reason.
      automation: stub("app.automation"),
      codingAgentApp: stub("app.codingAgentApp"),
      licensing: stub("app.licensing"),
      scimApp: stub("app.scimApp"),
      usageLimits: stub("app.usageLimits"),
      workflows: stub("app.workflows"),
      // The six slices the gateway-group half writes, present for the same
      // reason: the seal refuses a set any fold left unfilled, and the group's
      // own suite is what proves they answer.
      gateway: stub("app.gateway"),
      github: stub("app.github"),
      governance: stub("app.governance"),
      governanceApp: stub("app.governanceApp"),
      sessionPolicy: stub("app.sessionPolicy"),
      webhooks: stub("app.webhooks"),
    } as unknown as ApiTrpcFeatureApplication,
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
    auth: stub("auth"),
    batchRecord: stub("batchRecord"),
    dataset: stub("dataset"),
    evaluators: stub("evaluators"),
    evaluations: stub("evaluations", { mappingsSchema: anySchema }),
    experiments: stub("experiments", { workbenchStateSchema: anySchema }),
    graphs: stub("graphs", { filterFieldSchema: anySchema }),
    group: stub("group"),
    home: stub("home"),
    identity: stub("identity"),
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
    /**
     * The twenty-one gateway and governance surfaces, stubbed with only what
     * the record reads while it is being BUILT: the virtual-key budget parser
     * and the SaaS-billing decision, which chooses which router the two
     * billing namespaces ARE. Their own suite is what proves they answer.
     */
    gatewayGroup: {
      gateway: { virtualKeys: { virtualKeyBudgetInput: anySchema } },
      governanceHome: stub("gatewayGroup.governanceHome"),
      saasBilling: false,
    },
    github: stub("github"),
    user: stub("user"),
    workflows: {
      lifecycle: stub("workflows.lifecycle"),
      optimization: stub("workflows.optimization"),
    },
  } as unknown as AnyApiTrpcCollaborators;
}

/**
 * The setup checklist's provider step, as the process composes it: the REAL
 * `ModelProviderEvidenceService`, built by the model-provider package's own
 * adapter over its own client.
 *
 * Not a stub, because the seam being pinned is which code issues the read.
 * The client below is this reader's, and the one the product half is composed
 * on refuses every access to the same delegate — so the checklist can only be
 * answered by going through the feature.
 */
function testProviderEvidence() {
  const findFirst = vi.fn(async () => ({ id: "provider-1" }));
  const port = PostgresModelProviderEvidenceAdapter.create({
    database: { modelProvider: { findFirst } } as unknown as Pick<PrismaClient, "modelProvider">,
    projects: {
      tryGetWithTeam: async () => ({
        id: PROJECT_ID,
        teamId: TEAM_ID,
        team: { organizationId: ORGANIZATION_ID },
      }),
      getWithTeam: async () => ({
        id: PROJECT_ID,
        teamId: TEAM_ID,
        team: { organizationId: ORGANIZATION_ID },
      }),
    } as unknown as ModelCostProjectPort,
  }).build();

  return { port, findFirst };
}

function composeProductHalf(
  prisma: PrismaClient,
  clickHouse: ReturnType<typeof testClickHouse>,
  providerEvidence: ApiModelProviderEvidencePort,
) {
  return composeApiProductCollaborators({
    prisma,
    authz: testAuthz(),
    projects: {
      getWithTeam: async () => ({
        id: PROJECT_ID,
        teamId: TEAM_ID,
        departmentId: null,
        isPersonal: false,
        team: { organizationId: ORGANIZATION_ID },
      }),
      getOrganizationId: async () => ORGANIZATION_ID,
    } as unknown as ProjectService,
    modelProviders: providerEvidence,
    organizations: {
      getOrganizationMembers: async () => [],
      getTeamById: async () => ({ organizationId: ORGANIZATION_ID }),
    } as unknown as OrganizationService,
    users: { getProfiles: async () => [] } as unknown as UserService,
    processName: "langwatch-api",
    resolveClickHouseClient: clickHouse.resolveClient,
    // No queue: the two trace-side annotation markers refuse by name, which is
    // the composition's stated absence and not a path this file drives.
    eventing: undefined,
  });
}

function composeApplication() {
  const prisma = testPrisma();
  const clickHouse = testClickHouse([`trace-a`]);
  const broadcast = new EventEmitter();
  const audit = new RecordingAudit();
  const providers = testProviderEvidence();

  const collaborators = sealApiTrpcCollaborators(
    withApiProductCollaborators(
      baseCollaborators(broadcast),
      composeProductHalf(prisma.client, clickHouse, providers.port),
    ),
  );
  if (!collaborators) throw new Error("the collaborator set was sealed as incomplete");

  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: prisma.client } as unknown as PrismaConnection,
    authz: testAuthz(),
    audit,
    collaborators,
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: SESSION_USER.id }),
        tryActor: () => ({ id: SESSION_USER.id }),
        authorize: async () => undefined,
        session: { user: SESSION_USER },
      }),
      audit: async (event) => {
        await audit.record(event);
      },
      subscriptions: (ports) =>
        createSseSubscriptionApp({ security: subscriptionSecurity(), ports }).hono,
    },
  });

  return { application, prisma, clickHouse, broadcast, audit, features, providers };
}

/** The lane's own security; its credential services are never reached here. */
function subscriptionSecurity() {
  return ApiRestSecurity.create({
    apiKeys: stub("apiKeys"),
    authz: testAuthz(),
    organizations: stub("organizations"),
    observability: ApiRestObservabilityComposition.create(),
  });
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
  method: "query" | "mutation" = "query",
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const url = `http://127.0.0.1/api/trpc/${path}`;
  const response =
    method === "mutation"
      ? await application.hono.request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        })
      : await application.hono.request(
          `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
        );
  return { status: response.status, body: await response.json() };
}

/** Waits for a condition the stream reaches on its own, or gives up loudly. */
async function waitFor(reached: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!reached()) {
    if (Date.now() > deadline) throw new Error("the subscription never attached its listener");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The superjson frames of one SSE response, in order. */
function framesOf(body: string): unknown[] {
  return body
    .split("\n\n")
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n"),
    )
    .filter((payload) => payload.length > 0)
    .map((payload) => superjson.parse(payload));
}

describe("given an API process composed with the product half of the record", () => {
  describe("when the privacy settings page is opened", () => {
    /** @scenario "The data privacy snapshot is filtered by what the caller may read" */
    it("answers from the read model moved into the data-privacy package", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "dataPrivacy.getSnapshot", {
        projectId: PROJECT_ID,
      });

      expect({ status, body }).toMatchObject({ status: 200 });
      const snapshot = (body as { result: { data: { json: Record<string, unknown> } } }).result.data
        .json;

      expect(snapshot.projectId).toBe(PROJECT_ID);
      // Both baselines are resolved, which is the whole cascade running: the
      // TEAM one stops at this project's team, the ORGANIZATION one keeps only
      // organization rules.
      expect(snapshot.effectiveTeam).not.toBeNull();
      expect(snapshot.effectiveOrganization).not.toBeNull();

      // Both stored rules are readable here, and each is NAMED from the
      // directory rather than echoed back as its id.
      const rules = snapshot.rules as Array<{ scopeType: string; name: string }>;
      expect(rules.map((rule) => rule.scopeType).sort()).toEqual(["ORGANIZATION", "PROJECT"]);
      expect(rules.find((rule) => rule.scopeType === "ORGANIZATION")?.name).toBe("Acme");
      expect(rules.find((rule) => rule.scopeType === "PROJECT")?.name).toBe("Acme production");

      // The RBAC filter is observable rather than assumed: the second project
      // is in the organization's directory and the caller cannot write it, so
      // the chip picker is never offered it.
      const available = snapshot.available as { projects: Array<{ id: string }> };
      expect(available.projects.map((project) => project.id)).toEqual([PROJECT_ID]);
      expect((snapshot.audienceOptions as { groups: unknown[] }).groups).toEqual([
        { id: "group-1", name: "Auditors" },
      ]);
    });
  });

  describe("when traces are queued for annotation", () => {
    /** @scenario "An id no trace answers to is never queued for review" */
    it("queues only the ids trace storage answers to", async () => {
      const { application, prisma, clickHouse } = composeApplication();

      const { status, body } = await callTrpc(
        application,
        "annotation.createQueueItem",
        {
          projectId: PROJECT_ID,
          traceIds: ["trace-a", "trace-b"],
          annotators: ["queue-q1"],
        },
        "mutation",
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { created: 1, skipped: 1 } } } });

      // The existence answer came from trace storage, scoped by tenant, and it
      // is what decided the write.
      expect(clickHouse.query).toHaveBeenCalledTimes(1);
      expect(clickHouse.query).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: { tenantId: PROJECT_ID, traceIds: ["trace-a", "trace-b"] },
        }),
      );
      expect(prisma.queueItemWrites).toEqual([
        [
          {
            annotationQueueId: "q1",
            traceId: "trace-a",
            projectId: PROJECT_ID,
            createdByUserId: SESSION_USER.id,
          },
        ],
      ]);
    });
  });

  describe("when an operator opens the support inbox", () => {
    it("reads it through the repository moved into the ops package, and audits the read", async () => {
      const { application, audit } = composeApplication();

      const { status, body } = await callTrpc(application, "bugReports.getAll", {
        page: 0,
        pageSize: 25,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { total: 1, reports: [{ id: "bugreport_1" }] } } },
      });
      // Awaited, not fire-and-forget: the row is the record of who opened
      // somebody's transcript and it is written before they see it.
      expect(audit.entries.some((entry) => entry.path === "bugReports.getAll")).toBe(true);
    });
  });

  describe("when the onboarding screens render the setup checklist", () => {
    /**
     * The rollup lives in this composition rather than in a feature package,
     * and until now it read `prisma.modelProvider` here to fill its provider
     * step. That table holds every stored credential in the deployment, and
     * the rule that only the model-provider repository reads it is enforced by
     * a lint over IMPORTS — which a composition already holding the client
     * walks straight past.
     *
     * So the fake client below refuses every access to that delegate, and the
     * step is still answered: by the feature's own reader, which applies the
     * PROJECT -> TEAM -> ORGANIZATION cascade (an organization-wide credential
     * counts toward every project under it) and selects an id rather than a
     * credential column.
     */
    /** @scenario "All database access goes through the repository" */
    it("answers the provider step through the model-provider feature, not this connection", async () => {
      const { application, providers } = composeApplication();

      const { status, body } = await callTrpc(application, "integrationsChecks.getCheckStatus", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: {
          data: {
            json: {
              workflows: 1,
              customGraphs: 0,
              teamMembers: 2,
              modelProviders: 1,
              prompts: 0,
              // No scenario read composed, so the step reports not started
              // rather than guessing at "done".
              simulations: 0,
              firstMessage: true,
              integrated: false,
            },
          },
        },
      });

      expect(providers.findFirst).toHaveBeenCalledWith({
        where: {
          enabled: true,
          scopes: {
            some: {
              OR: [
                { scopeType: "PROJECT", scopeId: PROJECT_ID },
                { scopeType: "TEAM", scopeId: TEAM_ID },
                { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
              ],
            },
          },
        },
        select: { id: true },
      });
    });
  });

  describe("when a client watches an export over the subscription lane", () => {
    /** @scenario "A subscription in the record is watchable on the same root" */
    it("resolves the path against the same root the tRPC endpoint serves", async () => {
      const { application, broadcast } = composeApplication();
      if (!application.hono) throw new Error("HTTP composition was not created.");

      const input = encodeURIComponent(
        superjson.stringify({ projectId: PROJECT_ID, exportId: "export-1" }),
      );
      const response = await application.hono.request(
        `/api/sse/export.onExportProgress?input=${input}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");

      // The body has to be consumed for the relay to run at all, and the relay
      // attaches its listener only once it does — so the event is published
      // after the stream is live rather than into an emitter nobody watches.
      const body = response.text();
      await waitFor(() => broadcast.listenerCount("export_progress") > 0);
      broadcast.emit("export_progress", {
        event: JSON.stringify({ exportId: "export-1", type: "done" }),
        timestamp: Date.now(),
      });

      const frames = framesOf(await body);
      expect(frames[0]).toEqual({ type: "connected" });
      expect(frames[1]).toMatchObject({ exportId: "export-1", type: "done" });
      expect(frames.at(-1)).toEqual({ type: "complete" });
    });
  });

  describe("when every half has filled the entries it owns", () => {
    /** @scenario "A complete collaborator set mounts the whole record" */
    it("mounts every namespace the record declares, with no absence", () => {
      const { features } = composeApplication();

      const record = features.build(stubMount());

      expect(Object.keys(record).sort()).toEqual([...RECORD_NAMESPACES].sort());
      expect(RECORD_NAMESPACES).toHaveLength(91);
    });
  });

  describe("when a half left the entries it owns unfilled", () => {
    /** @scenario "An incomplete collaborator set composes no record and names the gap" */
    it("seals the set as incomplete and names every missing entry", () => {
      const reported: string[][] = [];
      const report = new (class extends ApiTrpcCollaboratorGapReport {
        incomplete(missing: readonly string[]): void {
          reported.push([...missing]);
        }
      })();

      const base = baseCollaborators(new EventEmitter());
      const withoutExecution = { ...base } as Record<string, unknown>;
      delete withoutExecution.evaluations;
      delete withoutExecution.workflows;
      const application = { ...(base.application as Record<string, unknown>) };
      delete application.evaluations;
      delete application.workflows;
      withoutExecution.application = application;

      const sealed = sealApiTrpcCollaborators(
        withApiProductCollaborators(
          withoutExecution as unknown as AnyApiTrpcCollaborators,
          composeProductHalf(testPrisma().client, testClickHouse([]), testProviderEvidence().port),
        ),
        report,
      );

      expect(sealed).toBeUndefined();
      // Named one by one: "the record did not mount" is a symptom every half
      // shares, and the names are what an operator can act on.
      expect(reported[0]).toEqual(
        expect.arrayContaining([
          "evaluations",
          "workflows",
          "application.evaluations",
          "application.workflows",
        ]),
      );
    });
  });

  describe("when the deployment composed no trace read pipeline", () => {
    /** @scenario "A capability the deployment does not hold refuses by name" */
    it("refuses the reviewer's trace content by name rather than answering an empty queue", async () => {
      const product = composeProductHalf(
        testPrisma().client,
        testClickHouse([]),
        testProviderEvidence().port,
      );

      await expect(
        product.annotationPorts.loadTraces({ actor: () => ({ id: SESSION_USER.id }) } as never, {
          projectId: PROJECT_ID,
          traceIds: ["trace-a"],
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });
  });
});

/**
 * The mount the record is built on, for the two structural assertions above.
 *
 * They ask what the record CONTAINS rather than what it answers, so the mount
 * only has to be constructible: every procedure builder below returns itself,
 * which is what a chain of decorators expects.
 */
function stubMount(): never {
  const procedure: Record<string, unknown> = {};
  const chain = new Proxy(procedure, {
    get: (_target, property) => {
      if (property === "_def") return {};
      return () => chain;
    },
  });
  const root = {
    // `_def.procedures` as well as the routes themselves: a real tRPC router
    // carries both, and the surfaces that merge sub-routers flat — the scenario
    // and suite transports — read the routes back off `_def`.
    router: (routes: Record<string, unknown>) =>
      Object.assign({}, routes, { _def: { procedures: routes } }),
    mergeRouters: (...routers: Array<Record<string, unknown>>) =>
      Object.assign({}, ...routers) as Record<string, unknown>,
    procedure: chain,
  };
  return {
    root,
    protectedProcedure: chain,
    publicProcedure: chain,
    // Every middleware answers a callable that yields a middleware object. The
    // chain above swallows whatever `.use()` is handed, so what a middleware IS
    // does not matter here — only that naming one never throws.
    middlewares: new Proxy(
      {},
      {
        get: () => {
          const middleware = () => middleware;
          return middleware;
        },
      },
    ),
  } as never;
}
