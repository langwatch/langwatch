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
import { ApiApplication, MissingAgentService, MissingSecretService } from "../../api.application";
import { LWQL_FLAG } from "@langwatch/analytics-server";
import { composeApiAnalyticsCollaborators } from "../api-trpc-collaborators.analytics.composition";
import {
  ApiTrpcFeaturesComposition,
  composeApiTrpcCollaborators,
} from "../api-trpc-features.composition";
import { stub, testHalves } from "./api-trpc-collaborators.test-halves";

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
    collaborators: composeApiTrpcCollaborators(testHalves({ analytics })),
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
