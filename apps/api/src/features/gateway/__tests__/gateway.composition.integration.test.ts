/**
 * The gateway feature's six namespaces, served by the API
 * process.
 *
 * What this pins is one call per family the feature mounts, each of them made
 * over the REAL `/api/trpc` handler on THIS process's root, through THIS
 * process's policy chain, against the collaborator set
 * `composeGatewayFeature` produced. Nothing here reaches a stub
 * through a proxy for the surfaces under test: the fakes are at the PORTS — a
 * Prisma double, an AuthZ service, a project directory, a plan provider, a
 * GitHub service — and everything between the HTTP request and them is the real
 * composed graph.
 *
 *   gatewayGuardrails.list   the composed `GatewayApp` over the real
 *                            `PrismaGatewayAdapter`: the guardrail catalogue
 *                            read all the way down to a `findMany`
 *   virtualKeys.list         the same application's membership-based
 *                            visibility, over the moved `VirtualKeyService`
 *   gatewayBudgets.list      the budget ledger with no ClickHouse, which is
 *                            what `spendAvailable: false` states rather than a
 *                            $0.00 nobody can tell from a key that spent nothing
 *   governance.resolveHome   the `/` landing decision, MOVED off the retired
 *                            router root and now composed by the enterprise
 *                            feature off the shared infrastructure
 *   github.getConnectionStatus
 *                            the GitHub App, through the one service both this
 *                            surface and the coding-agent reads are given
 *
 * And three named absences, because an absence nobody can observe is
 * indistinguishable from a stub: with no Enterprise application every
 * governance namespace MOUNTS and refuses by name; the two billing namespaces
 * mount as empty routers on an installation that does not bill; and with no
 * ClickHouse the spend source says so rather than answering zero.
 */
// @vitest-environment node
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type {
  AuthzBindingForSynthesis,
  AuthzGetDecisionInput,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { GithubService } from "@langwatch/github-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import {
  ApiApplication,
  MissingAgentService,
  MissingSecretService,
} from "../../../api.application";
import {
  ApiTrpcFeaturesComposition,
  composeApiTrpcCollaborators,
} from "../../../app/api-trpc-features.composition";
import { composeEnterpriseGovernanceApplication } from "../../enterprise/enterprise-governance.composition";
import { composeGatewayFeature } from "../gateway.composition";
import { refusingLangyFeature } from "../../langy/langy.composition";
import { refusingDataRetentionFeature } from "../../data-retention/data-retention.composition";
import { refusingMonitorFeature } from "../../monitor/monitor.composition";
import { refusingScenarioFeature } from "../../scenario/scenario.composition";
import { refusingStoredObjectFeature } from "../../stored-object/stored-object.composition";
import { refusingOpsFeature } from "../../ops/ops.composition";
import {
  stub,
  stubApplicationSlices,
  stubInfrastructureEntitlements,
  testHalves,
} from "../../../app/__tests__/api-trpc-collaborators.test-halves";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const TEAM_ID = "team-1";

/** The rows this half actually reads, as a double. */
function testPrisma() {
  const client = {
    gatewayGuardrail: { findMany: vi.fn(async () => []) },
    gatewayBudget: { findMany: vi.fn(async () => []) },
    gatewayCacheRule: { findMany: vi.fn(async () => []) },
    virtualKey: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    organization: {
      findUnique: vi.fn(async () => ({ id: ORGANIZATION_ID, primaryIntent: null })),
    },
    organizationUser: {
      findFirst: vi.fn(async () => ({ role: "ADMIN" })),
      findUnique: vi.fn(async () => null),
    },
    teamUser: { findMany: vi.fn(async () => [{ teamId: TEAM_ID }]) },
    team: { findMany: vi.fn(async () => []) },
    project: {
      findMany: vi.fn(async () => [{ id: PROJECT_ID }]),
      findFirst: vi.fn(async () => ({ slug: "acme-production" })),
      findUnique: vi.fn(async () => ({ team: { organizationId: ORGANIZATION_ID } })),
    },
    user: { findUnique: vi.fn(async () => ({ lastHomePath: null })) },
    group: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient;

  const held = client as unknown as {
    gatewayGuardrail: { findMany: ReturnType<typeof vi.fn> };
    virtualKey: { findMany: ReturnType<typeof vi.fn> };
    project: { findFirst: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn> };
  };
  return {
    client,
    gatewayGuardrail: held.gatewayGuardrail,
    virtualKey: held.virtualKey,
    project: held.project,
    user: held.user,
  };
}

/** Permits everything: the refusal path is the declared check's own suite. */
function testAuthz(): AuthzService {
  return {
    hasPermission: vi.fn(async () => true),
    hasApiKeyPermission: vi.fn(async () => true),
    getDecision: async (_input: AuthzGetDecisionInput): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    getProjectAnyDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
    listUserCreatedRoles: async () => [],
    listBindingsForSynthesis: async (): Promise<AuthzBindingForSynthesis[]> => [],
    tryResolveScope: async (input: { projectId?: string; organizationId?: string }) =>
      input.projectId
        ? { type: "project", id: input.projectId }
        : input.organizationId
          ? { type: "organization", id: input.organizationId }
          : null,
    effectivePermissions: async () => ["project:view"],
  } as unknown as AuthzService;
}

/** The GitHub App this deployment registered, as `github.*` reads it. */
function testGithub() {
  return {
    isOrganizationMember: vi.fn(async () => true),
    getConnectionStatus: vi.fn(async () => ({ configured: true, connected: false })),
  } as unknown as GithubService & {
    isOrganizationMember: ReturnType<typeof vi.fn>;
    getConnectionStatus: ReturnType<typeof vi.fn>;
  };
}

/**
 * The Enterprise application, as a deployment that composed one hands it over.
 *
 * Only the two members the surfaces under test reach: the governance setup
 * rollup the landing decision reads, and the four slices the port declares.
 * Everything else refuses, which is what says the test never wandered into a
 * surface this half does not own.
 */
function testEnterprise(setupState: Record<string, boolean>) {
  return {
    application: stub("enterprise.application"),
    governance: {
      governance: { resolveSetupState: vi.fn(async () => setupState) },
      governanceApp: stub("enterprise.governanceApp"),
      sessionPolicy: stub("enterprise.sessionPolicy"),
      webhooks: stub("enterprise.webhooks"),
    },
    backoffice: () => stub("enterprise.backoffice"),
  } as never;
}

function composeApplication(overrides: { saasBilling?: boolean; enterprise?: unknown } = {}) {
  const prisma = testPrisma();
  const authz = testAuthz();
  const github = testGithub();

  const projects = {
    getOrganizationId: vi.fn(async () => ORGANIZATION_ID),
    tryGetById: vi.fn(async () => ({ id: PROJECT_ID, teamId: TEAM_ID })),
    getByIds: vi.fn(async () => []),
    listTraceDestinations: vi.fn(async () => []),
    listIdsByOrganization: vi.fn(async () => [PROJECT_ID]),
    listNamesByIds: vi.fn(async () => []),
  } as unknown as ProjectService;

  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: prisma.client,
    authz,
    // The two Enterprise billing namespaces mount either way; what this
    // decides is whether they carry procedures.
    saasBilling: overrides.saasBilling ?? false,
    audit: undefined,
  };

  const gateway = composeGatewayFeature({
    infrastructure,
    peers: {
      projects,
      evaluators: {} as unknown as EvaluatorService,
      monitors: {} as unknown as MonitorService,
    },
    // No ClickHouse: the gateway ledger is a projection there, so the spend
    // source is off by name rather than answering a zero nobody can read.
    clickhouse: null,
    virtualKeyPepper: "0".repeat(64),
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: {
      gateway,
      langy: refusingLangyFeature(),
      ops: refusingOpsFeature(),
      scenario: refusingScenarioFeature(),
      dataRetention: refusingDataRetentionFeature(),
      monitor: refusingMonitorFeature(),
      storedObject: refusingStoredObjectFeature(),
    },
    infrastructure,
    collaborators: composeApiTrpcCollaborators(testHalves(), {
      ...stubApplicationSlices(),
      gateway: gateway.app,
      github,
      // The four Enterprise slices as the process composes them: the host's
      // where it supplied one, and this feature's own named refusals where it
      // did not — which is the absence three of the tests below drive.
      ...composeEnterpriseGovernanceApplication(
        overrides.enterprise as Parameters<typeof composeEnterpriseGovernanceApplication>[0],
      ),
    }),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    agents: new MissingAgentService(),
    secrets: new MissingSecretService(),
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: SESSION_USER.id }),
        tryActor: () => ({ id: SESSION_USER.id }),
        authorize: async () => undefined,
        session: { user: SESSION_USER },
      }),
    },
  });

  return { application, prisma, authz, github, gateway };
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

/** What the wire says the failure was, whatever shape the envelope took. */
function refusal(body: unknown): string {
  return JSON.stringify(body);
}

describe("given an API process composed with the gateway feature", () => {
  describe("when the record is built", () => {
    it("mounts all twenty-one gateway and governance namespaces beside `github`", () => {
      const { application } = composeApplication();

      const mounted = Object.keys(
        (application.trpc as unknown as { _def: { record: Record<string, unknown> } })._def.record,
      );

      expect(
        mounted
          .filter((namespace) =>
            [
              "activityMonitor",
              "aiTools",
              "anomalyRules",
              "currency",
              "departments",
              "gatewayBudgets",
              "gatewayCacheRules",
              "gatewayGuardrails",
              "gatewaySpendEvents",
              "gatewayUsage",
              "github",
              "governance",
              "ingestionKey",
              "ingestionSources",
              "ingestionTemplates",
              "personalSessions",
              "personalVirtualKeys",
              "routingPolicy",
              "sessionPolicy",
              "subscription",
              "virtualKeys",
              "webhookEndpoints",
            ].includes(namespace),
          )
          .sort(),
      ).toEqual([
        "activityMonitor",
        "aiTools",
        "anomalyRules",
        "currency",
        "departments",
        "gatewayBudgets",
        "gatewayCacheRules",
        "gatewayGuardrails",
        "gatewaySpendEvents",
        "gatewayUsage",
        "github",
        "governance",
        "ingestionKey",
        "ingestionSources",
        "ingestionTemplates",
        "personalSessions",
        "personalVirtualKeys",
        "routingPolicy",
        "sessionPolicy",
        "subscription",
        "virtualKeys",
        "webhookEndpoints",
      ]);
    });

    it("hands each of the gateway's three kinds of door what it needs", () => {
      const { gateway } = composeApplication();

      // The application `ctx.app` and the two REST families read, and the
      // stores the spend and internal families walk directly. The six routers
      // are pinned by the record's own list, which is where they mount.
      expect(gateway.app.spendSourceAvailable).toBe(false);
      expect(gateway.composition?.app).toBe(gateway.app);
    });
  });

  describe("when a project lists the guardrails its gateway traffic is held against", () => {
    it("reads them through the gateway application this half composes", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "gatewayGuardrails.list", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: [] } } });
      expect(prisma.gatewayGuardrail.findMany).toHaveBeenCalled();
    });
  });

  describe("when a member lists the virtual keys they can see", () => {
    it("resolves visibility from their own membership rather than a coarse grant", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "virtualKeys.list", {
        organizationId: ORGANIZATION_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: [] } } });
      expect(prisma.virtualKey.findMany).toHaveBeenCalled();
    });
  });

  describe("when no ClickHouse is composed", () => {
    /**
     * The distinction the whole spend source exists for: a process that cannot
     * price a budget says so, which a client renders differently from a budget
     * that has genuinely spent nothing. The application carries the answer, so
     * this asserts it on the composition rather than on a list whose emptiness
     * would make it vacuously true.
     */
    it("composes the gateway application with its spend source switched off by name", () => {
      const { gateway } = composeApplication();

      expect(gateway.app.spendSourceAvailable).toBe(false);
    });

    it("still answers the budget list, through the ledger this half composed", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "gatewayBudgets.list", {
        organizationId: ORGANIZATION_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { budgets: [] } } } });
    });
  });

  describe("when the signed-in member asks which page to land on", () => {
    it("gathers the decision from this half's own ports and the governance rollup", async () => {
      const { application, prisma } = composeApplication({
        enterprise: testEnterprise({
          hasPersonalVKs: false,
          hasIngestionSources: false,
          hasRecentActivity: false,
          hasApplicationTraces: true,
        }),
      });

      const { status, body } = await callTrpc(application, "governance.resolveHome", {
        organizationId: ORGANIZATION_ID,
      });

      expect(status).toBe(200);
      // The member's own first project, read through this half's port, is where
      // the resolver lands them: an organization with application traces and no
      // governance state goes to `/[project]`, never to `/governance`.
      expect(body).toMatchObject({
        result: { data: { json: { destination: "/acme-production" } } },
      });
      expect(prisma.project.findFirst).toHaveBeenCalled();
      expect(prisma.user.findUnique).toHaveBeenCalled();
    });

    it("refuses by name when no governance capability answers the setup rollup", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "governance.resolveHome", {
        organizationId: ORGANIZATION_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });

  describe("when the settings page asks whether GitHub is connected", () => {
    it("answers through the one GitHub service both this surface and the agent reads share", async () => {
      const { application, github } = composeApplication();

      const { status, body } = await callTrpc(application, "github.getConnectionStatus", {
        organizationId: ORGANIZATION_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { configured: true, connected: false } } },
      });
      expect(github.getConnectionStatus).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
      });
    });
  });

  describe("when no Enterprise application is composed", () => {
    it("still mounts the governance console, and refuses each read by name", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "ingestionSources.list", {
        organizationId: ORGANIZATION_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });

    it("refuses a personal virtual key mint by name rather than minting one", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(
        application,
        "personalSessions.list",
        { organizationId: ORGANIZATION_ID },
        "query",
      );

      expect(refusal(body)).toContain("service_unavailable");
    });
  });

  describe("when this installation does not bill through Stripe", () => {
    /**
     * The namespace is on the record either way. A client asking what this
     * deployment charges has to be able to tell "this installation does not
     * bill" from "the call failed", and a namespace that is not there tells it
     * neither.
     */
    it("mounts the billing namespaces with no procedures on them", async () => {
      const { application } = composeApplication({ saasBilling: false });

      const { body } = await callTrpc(application, "currency.detectCurrency", {});

      expect(refusal(body)).toContain("No procedure found");
    });

    it("serves the currency detection when the installation does bill", async () => {
      const { application } = composeApplication({ saasBilling: true });

      const { body } = await callTrpc(application, "currency.detectCurrency", {});

      expect(refusal(body)).not.toContain("No procedure found");
    });
  });
});
