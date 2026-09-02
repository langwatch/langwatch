/**
 * The analytics half of the collaborator set, composed for real and driven
 * over the real `/api/trpc` handler.
 *
 * What this pins is the thing the record was missing: `trpcCollaborators` is a
 * typed obligation, and until something satisfies it every one of the
 * twenty-two namespaces is absent in production. The two calls here are the two
 * halves this composition answers, and neither is stubbed on the way down —
 * the applications, the services, the repositories and the ClickHouse query
 * builder are the real ones, and only the two DATABASES are doubles.
 *
 *   analytics.getTimeseries  the charted read, from the packaged transport
 *                            through `AnalyticsApp`, `AnalyticsService` and the
 *                            ClickHouse repository to a statement issued
 *                            against the tenant's own client.
 *   dashboards.getAll        `DashboardApp` over the packaged Postgres adapter,
 *                            with the graph-visibility policy consulting the
 *                            real feature-flag service for the workbench
 *                            rollout — the collaborator that made this half one
 *                            composition rather than two.
 *
 * A fake ClickHouse client rather than a container: what is under test is the
 * COMPOSITION — that a statement is built, routed to the caller's tenant and
 * issued — and a real engine would only re-prove the query builder, which has
 * its own suites in `@langwatch/analytics-server`.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { AuthApp } from "@langwatch/auth-server";
import type {
  AuthzGetDecisionInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiAuditPort } from "../../api-request.policy";
import { ApiApplication } from "../../api.application";
import type { AnyApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import { LWQL_FLAG } from "@langwatch/analytics-server";
import {
  composeApiAnalyticsCollaborators,
  withApiAnalyticsCollaborators,
} from "../api-trpc-collaborators.analytics.composition";
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

const dashboardRow = {
  id: "dashboard-1",
  projectId: "project-1",
  name: "Overview",
  order: 0,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  _count: { graphs: 2 },
};

/**
 * One statement, as the fake engine received it.
 *
 * The tenant is recorded beside it because routing is half of what this proves:
 * a client resolved for the wrong tenant would still issue a valid statement.
 */
type IssuedStatement = { tenantId: string; query: string };

function testClickHouse() {
  const issued: IssuedStatement[] = [];
  const resolveClient = (tenantId: string): Promise<ClickHouseClient> =>
    Promise.resolve({
      query: (input: { query: string }) => {
        issued.push({ tenantId, query: input.query });
        return Promise.resolve({ json: () => Promise.resolve([]) });
      },
    } as unknown as ClickHouseClient);
  return { issued, resolveClient };
}

/**
 * The two tables this composition reads, and nothing else.
 *
 * Every other model answers a rejecting proxy, so a read this test did not
 * intend fails by name instead of quietly resolving to `undefined`.
 */
function testPrisma() {
  const dashboardFindMany = vi.fn(async () => [dashboardRow]);
  const featureFlagFindUnique = vi.fn(async () => null);

  const client = new Proxy(
    {
      dashboard: { findMany: dashboardFindMany },
      featureFlag: {
        findUnique: featureFlagFindUnique,
        findMany: async () => [],
      },
      featureFlagExperimentSetting: { findUnique: async () => null },
    },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return stub(`prisma.${String(property)}`);
      },
    },
  ) as unknown as PrismaClient;
  return { client, dashboardFindMany, featureFlagFindUnique };
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

/** The two project reads this half makes: the routing one and the policy one. */
function testProjects(): ProjectService {
  return {
    getOrganizationId: async () => "organization-1",
    getWithTeam: async (id: string) => ({
      id,
      teamId: "team-1",
      departmentId: null,
      isPersonal: false,
      team: { organizationId: "organization-1" },
    }),
  } as unknown as ProjectService;
}

function testResources(): ResourceScope {
  return { own: () => undefined } as unknown as ResourceScope;
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
 * Every collaborator the record needs EXCEPT the analytics half, stubbed.
 *
 * The fold under test replaces four of these entries — the analytics ports, the
 * graph ports and the two application slices — so what is left stubbed is
 * exactly what this composition does not own.
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

function composeApplication(
  options: { clickhouse?: boolean; workbenchEnabled?: boolean } = {},
) {
  const prisma = testPrisma();
  const clickhouse = testClickHouse();
  const analytics = composeApiAnalyticsCollaborators({
    prisma: prisma.client,
    authz: testAuthz(),
    projects: testProjects(),
    featureFlags: {
      overrides: new Map(),
      forceEnabled: new Set(options.workbenchEnabled === true ? [LWQL_FLAG] : []),
    },
    resolveClickHouseClient:
      options.clickhouse === false ? null : clickhouse.resolveClient,
    langWatchQL: undefined,
    resources: testResources(),
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: prisma.client } as unknown as PrismaConnection,
    authz: testAuthz(),
    audit: new (class extends ApiAuditPort {
      async record(): Promise<void> {}
    })(),
    collaborators: withApiAnalyticsCollaborators(otherCollaborators(), analytics),
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

  return { application, analytics, prisma, clickhouse };
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

describe("given the analytics collaborators composed over this process's own graph", () => {
  it("satisfies the record's typed obligation, so the namespaces mount", () => {
    const { application } = composeApplication();

    const mounted = Object.keys(
      (application.trpc as unknown as { _def: { record: Record<string, unknown> } })._def.record,
    );

    expect(mounted).toContain("analytics");
    expect(mounted).toContain("dashboards");
    expect(mounted).toContain("graphs");
  });

  describe("when a charted read is called through the real /api/trpc handler", () => {
    it("issues one statement against the calling project's own ClickHouse client", async () => {
      const { application, clickhouse } = composeApplication();

      const { status, body } = await callTrpc(application, "analytics.getTimeseries", {
        projectId: "project-1",
        startDate: Date.parse("2026-08-01T00:00:00.000Z"),
        endDate: Date.parse("2026-08-08T00:00:00.000Z"),
        timeZone: "UTC",
        series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { currentPeriod: [] } } } });
      expect(clickhouse.issued).toHaveLength(1);
      expect(clickhouse.issued[0]?.tenantId).toBe("project-1");
      // Tenant isolation is the property worth pinning, not the table the
      // router picked: every analytics statement filters on the caller's own
      // TenantId, and no other id in this schema is unique across tenants.
      expect(clickhouse.issued[0]?.query).toContain("TenantId = {tenantId:String}");
    });
  });

  describe("when a dashboards read is called through the real /api/trpc handler", () => {
    it("answers from the packaged Postgres adapter, with the workbench rollout consulted", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "dashboards.getAll", {
        projectId: "project-1",
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: [{ id: "dashboard-1", _count: { graphs: 2 } }] } },
      });
      expect(prisma.dashboardFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            _count: { select: { graphs: { where: { kind: { in: ["builder"] } } } } },
          },
        }),
      );
    });
  });

  describe("when the workbench rollout is off for this deployment", () => {
    it("reports the surface as switched off rather than as unprovisioned", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "analytics.lwql.availability", {
        projectId: "project-1",
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { available: false, reason: "disabled" } } },
      });
    });
  });

  describe("when the rollout is on but no restricted identity was configured", () => {
    it("tells the workbench the deployment is unprovisioned, which an admin cannot fix", async () => {
      const { application } = composeApplication({ workbenchEnabled: true });

      const { status, body } = await callTrpc(application, "analytics.lwql.availability", {
        projectId: "project-1",
      });

      expect(status).toBe(200);
      // The two refusals read differently on purpose: "disabled" is a switch an
      // administrator can flip, "unprovisioned" is a credential this
      // deployment does not have. Both answers come from this composition — the
      // first from the flag service, the second from the restricted identity's
      // own absence.
      expect(body).toMatchObject({
        result: { data: { json: { available: false, reason: "unprovisioned" } } },
      });
    });
  });

  describe("when the process composed no ClickHouse", () => {
    it("still mounts the namespaces, and the charted read refuses at the call", async () => {
      const { application } = composeApplication({ clickhouse: false });

      const { status } = await callTrpc(application, "analytics.getTimeseries", {
        projectId: "project-1",
        startDate: Date.parse("2026-08-01T00:00:00.000Z"),
        endDate: Date.parse("2026-08-08T00:00:00.000Z"),
        timeZone: "UTC",
        series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
      });

      expect(status).toBeGreaterThanOrEqual(400);
    });
  });
});
