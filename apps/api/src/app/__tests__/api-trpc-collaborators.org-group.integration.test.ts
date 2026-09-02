/**
 * The org-group half of the packaged tRPC record, served by the API process.
 *
 * What this pins is one call per namespace this half mounts, each of them made
 * over the REAL `/api/trpc` handler on THIS process's root, through THIS
 * process's policy chain, against the collaborator set
 * `composeApiOrgGroupCollaborators` produced. Nothing here reaches a stub
 * through a proxy for the surfaces under test: the fakes are at the PORTS — a
 * Prisma double, an AuthZ service, a project directory, a plan provider — and
 * everything between the HTTP request and them is the real composed graph.
 *
 *   organization.getAll          the organization directory, off `ctx.app`
 *   project.getHasFirstMessage   the MOVED project application: the row read
 *                                behind the setup screens, through the
 *                                `ProjectApp` this half composes
 *   codingAgents.usageTotals     the composed `CodingAgentApp` over a process
 *                                with no ClickHouse, which answers emptily
 *                                because a session is a projection there
 *   automation.getTriggers       the composed `AutomationApp` over the real
 *                                `PostgresAutomationAdapter`
 *   emailSuppression.getAll      the same application's suppression list, with
 *                                the audit row this process writes for it
 *
 * And four named absences, because an absence nobody can observe is
 * indistinguishable from a stub: with no invitation service the pending-invite
 * read refuses by name; with no protections resolver the field-redaction read
 * refuses rather than guessing what a viewer may see; with no Enterprise
 * application `license.getStatus` refuses while still MOUNTING; and the
 * clustering request refuses because no scheduler runs here.
 */
import type {
  AuthzBindingForSynthesis,
  AuthzGetDecisionInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { GithubService } from "@langwatch/github-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import type { TopicService } from "@langwatch/topic-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiApplication } from "../../api.application";
import type { AnyApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import { ApiTrpcFeaturesComposition } from "../api-trpc-features.composition";
import {
  composeApiOrgGroupCollaborators,
  withApiOrgGroupCollaborators,
} from "../api-trpc-collaborators.org-group.composition";

/**
 * A collaborator group with only the members the record reads while it is
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
const passThroughMiddleware = ({ next }: { next: () => unknown }) => next();

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";

/** The rows this half actually reads, as a double. */
function testPrisma() {
  const client = {
    project: {
      findUnique: vi.fn(async () => ({ id: PROJECT_ID, firstMessage: true })),
      findFirst: vi.fn(async () => ({ id: PROJECT_ID, firstMessage: true })),
      findMany: vi.fn(async () => []),
    },
    trigger: { findMany: vi.fn(async () => []) },
    triggerSent: { findMany: vi.fn(async () => []) },
    emailSuppression: { findMany: vi.fn(async () => []) },
    organizationInvite: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => [
        {
          id: "invite-1",
          organizationId: ORGANIZATION_ID,
          email: "newcomer@acme.test",
          inviteCode: "code-1",
          role: "MEMBER",
          status: "PENDING",
          teamIds: "",
          expiration: new Date("2099-01-01T00:00:00.000Z"),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          requestedByUser: null,
        },
      ]),
    },
    organizationUser: { findUnique: vi.fn(async () => null) },
    team: { findUnique: vi.fn(async () => ({ organizationId: ORGANIZATION_ID })) },
    teamUser: { findMany: vi.fn(async () => []) },
    user: { findFirst: vi.fn(async () => null) },
  } as unknown as PrismaClient;

  const held = client as unknown as { trigger: { findMany: ReturnType<typeof vi.fn> } };
  return { client, trigger: held.trigger };
}

/** Permits everything: the refusal path is the declared check's own suite. */
function testAuthz(): AuthzService {
  return {
    hasPermission: vi.fn(async () => true),
    getDecision: async (_input: AuthzGetDecisionInput): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    getProjectAnyDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    checkScopeLineage: async (): Promise<AuthzScopeLineageResult> => ({ kind: "consistent" }),
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

/**
 * The rest of the record, stubbed: this file describes the org-group half, and
 * a namespace it does not own answering a call would mean the test had
 * wandered.
 */
function baseCollaborators(organizations: unknown): AnyApiTrpcCollaborators {
  return {
    application: stub<ApiTrpcFeatureApplication>("app", { organizations }),
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
    auth: stub("auth"),
    batchRecord: stub("batchRecord"),
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
     * The agent and product-infrastructure groups, stubbed with only what the
     * record reads while it is BUILT. Their own suites are what prove they
     * answer.
     */
    /**
     * The twenty-one gateway and governance surfaces, stubbed with only what
     * the record reads while it is BUILT: the virtual-key budget parser and
     * the SaaS-billing decision, which chooses which router the two billing
     * namespaces ARE. Their own suite is what proves they answer.
     */
    gatewayGroup: {
      gateway: { virtualKeys: { virtualKeyBudgetInput: anySchema } },
      governanceHome: stub("gatewayGroup.governanceHome"),
      saasBilling: false,
    },
    github: stub("github"),
    agentGroup: {
      langy: stub("agentGroup.langy"),
      langyGates: {
        refuseDemoProject: passThroughMiddleware,
        enforceLangyAccess: passThroughMiddleware,
      },
      langyEgress: stub("agentGroup.langyEgress"),
      ops: stub("agentGroup.ops"),
      // Read at BUILD time — the mount asks it for a middleware — so it
      // answers one rather than being one.
      opsCheck: () => passThroughMiddleware,
      scenarios: stub("agentGroup.scenarios"),
    },
    productInfra: {
      dataRetention: stub("productInfra.dataRetention"),
      monitors: stub("productInfra.monitors", { preconditionsSchema: anySchema }),
    },
    user: stub("user"),
    workflows: {
      lifecycle: stub("workflows.lifecycle"),
      optimization: stub("workflows.optimization"),
    },
  } as unknown as AnyApiTrpcCollaborators;
}

/** The organization application the identity half owns, as `organization.*` reads it. */
function testOrganizationApp() {
  return {
    getAllForUser: vi.fn(async () => [{ id: ORGANIZATION_ID, name: "Acme" }]),
    isMember: vi.fn(async () => true),
  };
}

/**
 * The two collaborators the invitation half is composed over.
 *
 * Absent, the half is not composed and the eleven invitation ports refuse by
 * name — the case below the answering one. Present, this process builds the
 * service itself, which is what the injected port used to stand in for.
 */
function composeApplication(options: { withInvitations?: boolean } = {}) {
  const prisma = testPrisma();
  const authz = testAuthz();
  const organizations = testOrganizationApp();
  const audit = { record: vi.fn(async () => undefined) };

  const projects = {
    getOrganizationId: vi.fn(async () => ORGANIZATION_ID),
    tryGetById: vi.fn(async () => ({ id: PROJECT_ID, firstMessage: true })),
    tryGetSummaryById: vi.fn(async () => ({ name: "Acme", slug: "acme" })),
  } as unknown as ProjectService;

  const group = composeApiOrgGroupCollaborators({
    prisma: prisma.client,
    authz,
    organizations: {} as unknown as OrganizationService,
    projects,
    apiKeys: {} as unknown as ApiKeyService,
    share: {} as unknown as ShareService,
    topics: {
      getClusteringStatus: vi.fn(async () => ({ isRunInFlight: false })),
    } as unknown as TopicService,
    monitors: { getAllByIds: vi.fn(async () => []) } as unknown as MonitorService,
    featureFlags: { isEnabled: vi.fn(async () => true) } as never,
    plans: { getActivePlan: vi.fn(async () => ({ type: "FREE", free: true })) } as never,
    encryption: { encrypt: (value: string) => value, decrypt: (value: string) => value } as never,
    audit,
    redis: null,
    rateLimit: async () => ({ allowed: true, resetAt: 0 }),
    unsubscribeSecret: "0".repeat(64),
    baseHost: "https://app.langwatch.test",
    demoProject: { userId: "", projectId: "" },
    github: {} as unknown as GithubService,
    // No ClickHouse: a coding-agent session is a projection there, so the
    // package's own null repositories answer emptily.
    codingAgentClickHouse: null,
    ...(options.withInvitations
      ? {
          authzGrants: {
            grant: vi.fn(async () => undefined),
            revoke: vi.fn(async () => undefined),
          } as never,
          roles: { listAssignableCustomRoles: vi.fn(async () => []) } as never,
        }
      : {}),
    processName: "langwatch-api-test",
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: prisma.client } as unknown as PrismaConnection,
    authz,
    audit: undefined,
    collaborators: withApiOrgGroupCollaborators(baseCollaborators(organizations), group),
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
    },
  });

  const invites = (
    prisma.client as unknown as {
      organizationInvite: { findMany: ReturnType<typeof vi.fn> };
    }
  ).organizationInvite;

  return { application, prisma, authz, organizations, projects, group, audit, invites };
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

describe("given an API process composed with the org-group half of the record", () => {
  describe("when the record is built", () => {
    it("mounts all nine tenant-administration namespaces", () => {
      const { group } = composeApplication();

      expect(Object.keys(group.ports).sort()).toEqual([
        "automation",
        "codingAgents",
        "emailSuppression",
        "enterprise",
        "organization",
        "organizationAuditLogCheck",
        "project",
        "projectChecks",
      ]);
    });
  });

  describe("when the setup screen asks whether a project has its first trace", () => {
    it("answers through the project application this half composes", async () => {
      const { application, projects } = composeApplication();

      const { status, body } = await callTrpc(application, "project.getHasFirstMessage", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { firstMessage: true } } } });
      expect(projects.tryGetById).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  describe("when the coding-agent page asks for a project's usage", () => {
    it("answers emptily on a process with no session storage", async () => {
      const { application } = composeApplication();

      const { status } = await callTrpc(application, "codingAgents.usageTotals", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
    });
  });

  describe("when a project lists its automations", () => {
    it("reads them through the composed automation application", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "automation.getTriggers", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: [] } } });
      expect(prisma.trigger.findMany).toHaveBeenCalled();
    });
  });

  describe("when a project lists the addresses that unsubscribed", () => {
    it("answers from the same automation application and records the read", async () => {
      const { application, audit } = composeApplication();

      const { status } = await callTrpc(application, "emailSuppression.getAll", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(audit.record).toHaveBeenCalled();
    });
  });

  describe("when no invitation service is composed", () => {
    it("refuses the pending-invite read by name rather than answering with none", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "organization.getOrganizationPendingInvites", {
        organizationId: ORGANIZATION_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });

  describe("when the grant ledger and the role service are composed", () => {
    /**
     * The absence above is closed by this process building the service itself
     * rather than by a host injecting one. What that has to prove is that the
     * read reaches the ROW — a port that answered `[]` would pass a test which
     * only checked the call stopped refusing, and an empty invitation list is
     * the one answer an administrator acts on by inviting the same person
     * twice.
     */
    it("answers the pending-invite read from the invitation rows", async () => {
      const { application, invites } = composeApplication({ withInvitations: true });

      const { status, body } = await callTrpc(
        application,
        "organization.getOrganizationPendingInvites",
        { organizationId: ORGANIZATION_ID },
      );

      expect(status).toBe(200);
      expect(refusal(body)).not.toContain("service_unavailable");
      expect(refusal(body)).toContain("newcomer@acme.test");
      expect(invites.findMany).toHaveBeenCalled();
    });

    /**
     * The acceptance link is the thing an administrator hands somebody when no
     * mail gateway is composed, and it is minted from the deployment's public
     * origin. A link built against a default host would look right in the
     * listing and open nothing.
     */
    it("carries an acceptance link on this deployment's own origin", async () => {
      const { application } = composeApplication({ withInvitations: true });

      const { body } = await callTrpc(
        application,
        "organization.getOrganizationPendingInvites",
        { organizationId: ORGANIZATION_ID },
      );

      expect(refusal(body)).toContain(
        "https://app.langwatch.test/invite/accept?inviteCode=code-1",
      );
    });
  });

  describe("when no protections resolver is composed", () => {
    it("refuses the field-redaction read by name rather than guessing", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "project.getFieldRedactionStatus", {
        projectId: PROJECT_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });

  describe("when no clustering scheduler runs in this process", () => {
    /**
     * The refusal is real and named — the composition raises
     * `service_unavailable` naming the scheduler — but the project transport
     * deliberately degrades EVERY clustering failure to an unnamed error,
     * because the causes behind it are event-store internals a caller cannot
     * act on. So what a caller observes is a failure with a trace id rather
     * than an accepted run; the name is in this process's log.
     */
    it("fails the request rather than accepting a run nobody starts", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(
        application,
        "project.triggerTopicClustering",
        { projectId: PROJECT_ID },
        "mutation",
      );

      expect(status).toBe(500);
      expect(refusal(body)).toContain("Failed to trigger topic clustering");
      expect(refusal(body)).not.toContain('"success":true');
    });
  });

  describe("when no Enterprise application is composed", () => {
    it("still mounts the licence surface, and refuses the read by name", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "license.getStatus", {
        organizationId: ORGANIZATION_ID,
      });

      expect(refusal(body)).toContain("service_unavailable");
    });
  });
});
