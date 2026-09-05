/**
 * The packaged tRPC record, served by the API process. What this pins is the seam the
 * migration turns on: `createAppTrpcFeatures` built on THIS process's root, with THIS
 * process's policy chain, reachable over the real `/api/trpc` handler.
 */
import { AuthService } from "@langwatch/auth-contract";
import type { BrowserSession, VerifiedBrowserSession } from "@langwatch/auth-contract";
import { AuthApp } from "@langwatch/auth-server";
import type {
  AuthzGetDecisionInput,
  AuthzPermission,
  AuthzScopeLineageInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ApiApplication,
  MissingAgentService,
  MissingSecretService,
  NoApiTrpcFeatures,
} from "../../api.application";
import { ApiAuditPort, ApiAuthorizationPort, ApiRequestPolicy } from "../../api-request.policy";
import type { UserService } from "@langwatch/user-contract";
import { composeAuthFeature } from "../../features/auth/auth.composition";
import { composeBugReportFeature } from "../../features/bug-report/bug-report.composition";
import { composeOrganizationFeature } from "../../features/organization/organization.composition";
import { composeWorkflowFeature } from "../../features/workflow/workflow.composition";
import {
  AuthSessionApiAuthenticationAdapter,
  BetterAuthBrowserSessionTransportAdapter,
} from "../api-auth.composition";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import {
  ApiTrpcFeaturesComposition,
  LoggedApiTrpcFeaturesAbsence,
} from "../api-trpc-features.composition";
import {
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "./api-trpc-record.test-doubles";

/**
 * The namespaces `createAppTrpcFeatures` mounts, as the wire names them.
 */
const RECORD_NAMESPACES = [
  "analytics",
  "annotation",
  "annotationScore",
  "apiKey",
  "authz",
  "batchRecord",
  "bugReports",
  "dashboards",
  "dataPrivacy",
  "dataset",
  "datasetRecord",
  "evaluations",
  "evaluators",
  "experiments",
  "export",
  "frontDoor",
  "featureFlag",
  "graphs",
  "group",
  "home",
  "identity",
  "integrationsChecks",
  "joinRequests",
  "onboarding",
  "optimization",
  "personalWorkspaceFeatures",
  "presence",
  "promptTags",
  "prompts",
  "publicEnv",
  "team",
  "user",
  "workflow",
] as const;

/**
 * A collaborator group with only the members the record reads while it is being BUILT —
 * the input schemas, and the one decorator a rollout gate applies to a procedure.
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

/** A schema that accepts whatever a test sends it. */
const anySchema = z.any();

/** The rollout gate, open: the closed case is the workbench feature's own suite. */

/**
 * A middleware that does nothing, for the custom checks a mount installs while
 * the record is being BUILT.
 */
const passThroughMiddleware = ({ next }: { next: () => unknown }) => next();

const workflowRow = {
  id: "workflow-1",
  projectId: "project-1",
  name: "Summarise",
  icon: "",
  description: "",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  latestVersionId: null,
  currentVersionId: null,
  publishedId: null,
  publishedById: null,
  archivedAt: null,
  isEvaluator: false,
  isComponent: false,
  copiedFromWorkflowId: null,
  copiedFrom: null,
  copiedWorkflows: [],
};

const dashboardRow = { id: "dashboard-1", name: "Overview", graphCount: 0 };

function testPrisma() {
  const findMany = vi.fn(async () => [workflowRow]);
  return {
    client: {
      workflow: { findMany },
      bugReport: {
        findMany: vi.fn(async () => [{ id: "report-1" }]),
        count: vi.fn(async () => 1),
      },
    } as unknown as PrismaClient,
    findMany,
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

class RecordingAudit extends ApiAuditPort {
  readonly entries: unknown[] = [];

  async record(event: unknown): Promise<void> {
    this.entries.push(event);
  }
}

function testApplication(overrides: Record<string, unknown> = {}): ApiTrpcFeatureApplication {
  return {
    ...stub<ApiTrpcFeatureApplication>("app"),
    dashboard: {
      getAll: async () => [dashboardRow],
    },
    ops: { isAdmin: () => true },
    monitors: stub("app.monitors"),
    storedObjectApp: stub("app.storedObjectApp"),
    config: { opsSidebarEmails: ["staff@langwatch.ai"] },
    ...overrides,
  } as unknown as ApiTrpcFeatureApplication;
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

function testCollaborators(overrides: Record<string, unknown> = {}) {
  return {
    application: testApplication(),
    annotation: stub("annotation"),
    auth: testAuthApp(),
    dataPrivacy: stub("dataPrivacy"),
    evaluations: stub("evaluations", { mappingsSchema: anySchema }),
    experiments: stub("experiments", { workbenchStateSchema: anySchema }),
    group: stub("group"),
    home: stub("home"),
    identity: stub("identity"),
    integrationsChecks: stub("integrationsChecks"),
    joinRequests: stub("joinRequests"),
    onboarding: stub("onboarding", { signUpDataSchema: anySchema }),
    role: stub("role", { customRolePermission: anySchema }),
    team: stub("team"),
    /**
     * The trace group, stubbed with only what the record reads while it is being BUILT:
     * the input schemas its procedures are parsed with, and the two custom checks its
     * model-provider mount wraps a procedure in. Its own suite is what proves it answers.
     */
    organization: stub("organization", {
      signUpDataSchema: anySchema,
      isCustomRole: () => false,
    }),
    organizationAuditLogCheck: passThroughMiddleware,
    project: stub("project"),
    projectChecks: {
      create: passThroughMiddleware,
      traceSharing: passThroughMiddleware,
    },
    codingAgents: stub("codingAgents"),
    automation: stub("automation", {
      providers: stub("automation.providers"),
    }),
    emailSuppression: stub("emailSuppression"),
    enterprise: {
      scimToken: stub("enterprise.scimToken"),
      ssoConnections: stub("enterprise.ssoConnections"),
    },
    traces: stub("traces", {
      listInputSchema: anySchema,
      filterInputSchema: anySchema,
      evaluatorTypeSchema: anySchema,
      preconditionSchema: anySchema,
    }),
    tracesV2: stub("tracesV2", { traceMetadataUpdateSchema: anySchema }),
    spans: stub("spans"),
    traceEditOverlay: stub("traceEditOverlay"),
    sharedTrace: stub("sharedTrace"),
    savedViews: stub("savedViews"),
    costs: stub("costs"),
    llmModelCost: stub("llmModelCost"),
    modelProvider: stub("modelProvider"),
    modelProviderChecks: {
      tenantWrite: () => passThroughMiddleware,
      credentialProbe: passThroughMiddleware,
    },
    translate: stub("translate"),
    httpProxy: stub("httpProxy"),
    limits: stub("limits"),
    /**
     * The six agent surfaces, stubbed with only what the record reads while it is being
     * BUILT.
     */
    gateway: { virtualKeys: { virtualKeyBudgetInput: anySchema } },
    github: stub("github"),
    scenarios: stub("scenarios"),
    langy: stub("langy"),
    langyGates: {
      refuseDemoProject: passThroughMiddleware,
      enforceLangyAccess: passThroughMiddleware,
    },
    langyEgress: stub("langyEgress"),
    ops: stub("ops"),
    opsCheck: () => passThroughMiddleware,
    user: stub("user"),
    workflows: {
      lifecycle: stub("workflows.lifecycle"),
      optimization: stub("workflows.optimization"),
    },
    ...overrides,
  } as never;
}

function composeApplication(
  overrides: {
    session?: { user: { id: string; email?: string | null; role?: string | null } } | null;
  } = {},
) {
  const prisma = testPrisma();
  const audit = new RecordingAudit();
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: prisma.client,
    authz: testAuthz(),
    audit,
  };
  const features = ApiTrpcFeaturesComposition.tryCompose({
    // The support inbox composes itself off the same infrastructure, so the
    // audit row below is the one that composition writes.
    composed: {
      ...stubComposedFeatures(),
      // The support inbox and the signed-out doors compose themselves off this
      // process's own graph, so both the audit row and `publicEnv`'s answer
      // below are the ones those compositions produce.
      bugReport: composeBugReportFeature({ infrastructure }),
      // The studio composes itself off the same infrastructure, so the row
      // read below is the one it runs on this process's own connection.
      workflow: composeWorkflowFeature({
        infrastructure,
        runtime: {
          workflows: stub("workflow.workflows"),
          nlpRuntime: stub("workflow.nlpRuntime"),
        },
        peers: {
          datasets: stub("workflow.datasets"),
          evaluators: stub("workflow.evaluators"),
          modelProviders: stub("workflow.modelProviders"),
        },
      }),
      auth: composeAuthFeature({
        prisma: prisma.client,
        peers: { users: {} as unknown as UserService },
        rateLimit: async () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
        deployment: {},
        processName: "langwatch-api",
      }),
    },
    infrastructure,
    collaborators: testCollaborators(),
  });
  if (!features) throw new Error("the record refused to compose against its test collaborators");

  const session =
    overrides.session === undefined
      ? { user: { id: "user-1", email: "staff@langwatch.ai", role: "ADMIN" } }
      : overrides.session;

  const application = ApiApplication.create({
    agents: new MissingAgentService(),
    secrets: new MissingSecretService(),
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: "user-1" }),
        tryActor: () => (session ? { id: session.user.id } : null),
        authorize: async () => undefined,
        session,
      }),
      audit: async (event) => {
        await audit.record(event);
      },
    },
  });

  return { application, prisma, audit };
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

describe("given an API process composed with the packaged tRPC collaborators", () => {
  it("mounts every namespace the record owns beside the process's own routers", () => {
    const { application } = composeApplication();

    const mounted = Object.keys(
      (application.trpc as unknown as { _def: { record: Record<string, unknown> } })._def.record,
    );

    for (const namespace of RECORD_NAMESPACES) {
      expect(mounted).toContain(namespace);
    }
  });

  describe("when a procedure reads an application slice behind a declared permission", () => {
    it("answers it through the real /api/trpc handler", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "dashboards.getAll", {
        projectId: "project-1",
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: [{ id: "dashboard-1" }] } } });
    });
  });

  describe("when a procedure reads a row this composition lifted onto its own connection", () => {
    it("runs the query on the process's Prisma client rather than one off the request", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "workflow.getAll", {
        projectId: "project-1",
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: [{ id: "workflow-1" }] } } });
      expect(prisma.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "project-1", archivedAt: null },
        }),
      );
    });
  });

  describe("when a back-office read reaches the collaborator's own store", () => {
    it("writes the audit row before answering", async () => {
      const { application, audit } = composeApplication();

      const { status } = await callTrpc(application, "bugReports.getAll", {
        page: 1,
        pageSize: 10,
      });

      expect(status).toBe(200);
      expect(audit.entries).toContainEqual(
        expect.objectContaining({ path: "bugReports.getAll", actorId: "user-1" }),
      );
    });
  });

  describe("when the caller has no session at all", () => {
    it("still answers the signed-out door on the public procedure", async () => {
      const { application } = composeApplication({ session: null });

      const { status, body } = await callTrpc(application, "publicEnv", {});

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { NEXTAUTH_PROVIDER: "email" } } },
      });
    });
  });
});

describe("given an API process with no collaborators for the record", () => {
  it("composes no record and names the absence", () => {
    const warn = vi.fn();

    const features = ApiTrpcFeaturesComposition.tryCompose({
      composed: stubComposedFeatures(),
      infrastructure: {
        ...stubInfrastructureEntitlements(),
        prisma: {} as unknown as PrismaClient,
        authz: testAuthz(),
        audit: undefined,
      },
      collaborators: undefined,
      report: LoggedApiTrpcFeaturesAbsence.create({ warn }),
    });

    expect(features).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      { reason: "no-collaborators" },
      expect.stringContaining("serves no packaged tRPC namespaces"),
    );
  });

  it("serves its own two routers unchanged", () => {
    const application = ApiApplication.create({
      features: new NoApiTrpcFeatures(),
      agents: new MissingAgentService(),
      secrets: new MissingSecretService(),
      http: {
        createContext: async () => ({
          actor: () => ({ id: "user-1" }),
          authorize: async () => undefined,
        }),
      },
    });

    const mounted = Object.keys(
      (application.trpc as unknown as { _def: { record: Record<string, unknown> } })._def.record,
    );

    expect(mounted).not.toContain("dashboards");
  });
});

/**
 * The infrastructure is one object, so "a connection but no permission service" is no
 * longer a state a caller can reach: `ApiTrpcInfrastructure` requires both, and the
 * production root builds it only when it holds both.
 */
describe("given a process that opened no infrastructure for the record", () => {
  it("refuses the record rather than mounting authorized surfaces over nothing", () => {
    const warn = vi.fn();

    const features = ApiTrpcFeaturesComposition.tryCompose({
      composed: stubComposedFeatures(),
      infrastructure: undefined,
      collaborators: testCollaborators(),
      report: LoggedApiTrpcFeaturesAbsence.create({ warn }),
    });

    expect(features).toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ reason: "no-database" }, expect.any(String));
  });
});

/**
 * The signed-in caller, in the two shapes the process holds them: what Better
 * Auth verifies off the cookie, and what the Auth service resolves from it.
 */
const verifiedSession: VerifiedBrowserSession = {
  session: { id: "session-1", expiresAt: new Date("2026-12-01T00:00:00.000Z") },
  user: { id: "user-1", name: "Ada", email: "ada@example.test" },
};

const resolvedSession: BrowserSession = {
  user: { id: "user-1", name: "Ada", email: "ada@example.test", image: null },
  expires: "2026-12-01T00:00:00.000Z",
  sessionId: "session-1",
};

/** What the Auth service resolves when an administrator is acting as somebody. */
const impersonatedSession: BrowserSession = {
  user: {
    id: "user-2",
    name: "Grace",
    email: "grace@example.test",
    image: null,
    impersonator: { id: "user-1", name: "Ada", email: "ada@example.test", image: null },
  },
  expires: "2026-12-01T00:00:00.000Z",
  sessionId: "session-1",
};

class SessionResolvingAuthService extends AuthService {
  constructor(private readonly resolved: BrowserSession | null) {
    super();
  }

  async tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null> {
    return input.verified ? this.resolved : null;
  }

  async revokeAllBrowserSessions(): Promise<void> {}
  async revokeBrowserSession(): Promise<void> {}
  async revokeOtherBrowserSessions(): Promise<void> {}
}

/** Permits everything: the refusal path is the declared check's own suite. */
class PermittingAuthorization extends ApiAuthorizationPort {
  async can(_input: {
    userId: string;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<boolean> {
    return true;
  }

  async authorizeProject(_input: {
    userId: string;
    permission: AuthzPermission;
    projectId: string;
  }): Promise<void> {}

  async checkScopeLineage(_input: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult> {
    return { kind: "consistent" };
  }
}

/**
 * The application behind the REAL request policy, rather than a hand-written
 * context: what F1 broke lived between the auth adapter and the context, so a
 * test that supplies its own context cannot see it.
 */
function composeSessionApplication(options: {
  verified: VerifiedBrowserSession | null;
  getAllForUser: (...args: never[]) => Promise<unknown[]>;
  session?: BrowserSession;
}) {
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: testPrisma().client,
    authz: testAuthz(),
    audit: new RecordingAudit(),
  };
  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: {
      ...stubComposedFeatures(),
      // `organization.*` is the surface under test, so the real feature is
      // composed here. The directory it answers from stays the injected
      // double, because the namespace reads it off `ctx.app.organizations`.
      organization: composeOrganizationFeature({
        infrastructure,
        peers: { encryption: undefined },
        rateLimit: async () => ({ allowed: true, resetAt: 0 }),
        baseHost: "https://app.langwatch.test",
        demoProject: { userId: "demo-user", projectId: "demo-project" },
      }),
    },
    infrastructure,
    collaborators: testCollaborators({
      application: testApplication({
        organizations: { getAllForUser: options.getAllForUser },
      }),
    }),
  });
  if (!features) throw new Error("the record refused to compose against its test collaborators");

  const policy = ApiRequestPolicy.create({
    authentication: AuthSessionApiAuthenticationAdapter.create({
      auth: new SessionResolvingAuthService(options.session ?? resolvedSession),
      sessions: BetterAuthBrowserSessionTransportAdapter.create({
        handler: () =>
          Promise.reject(new Error("These tests resolve sessions; they route no auth request.")),
        api: { getSession: async () => options.verified },
      }),
    }),
    authorization: new PermittingAuthorization(),
  });

  return ApiApplication.create({
    agents: new MissingAgentService(),
    secrets: new MissingSecretService(),
    features,
    http: policy.asHttpOptions(),
  });
}

describe("given a browser session this process has already verified", () => {
  describe("when a packaged surface reads the signed-in person off the context", () => {
    /** @scenario "A verified browser session reaches the surfaces that render the person" */
    it("reaches the organization service instead of refusing the caller", async () => {
      const getAllForUser = vi.fn(async () => []);
      const application = composeSessionApplication({ verified: verifiedSession, getAllForUser });

      const { status, body } = await callTrpc(application, "organization.getAll", {
        isDemo: false,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: [] } } });
      expect(getAllForUser).toHaveBeenCalledWith(
        expect.objectContaining({ isDemo: false }),
        expect.objectContaining({ id: "user-1" }),
      );
    });
  });

  describe("when an administrator is acting as that person", () => {
    /** @scenario "An impersonated session reaches the surface as the impersonated person" */
    it("reaches the service as the impersonated person, carrying the real administrator", async () => {
      const getAllForUser = vi.fn(async () => []);
      const application = composeSessionApplication({
        verified: verifiedSession,
        getAllForUser,
        session: impersonatedSession,
      });

      const { status } = await callTrpc(application, "organization.getAll", { isDemo: false });

      expect(status).toBe(200);
      expect(getAllForUser).toHaveBeenCalledWith(
        expect.objectContaining({ isDemo: false }),
        expect.objectContaining({
          id: "user-2",
          impersonator: expect.objectContaining({ id: "user-1" }),
        }),
      );
    });
  });

  describe("when no cookie verifies the caller", () => {
    /** @scenario "An anonymous caller stays refused by the same surface" */
    it("keeps the same surface unauthorized and never reaches the service", async () => {
      const getAllForUser = vi.fn(async () => []);
      const application = composeSessionApplication({ verified: null, getAllForUser });

      const { body } = await callTrpc(application, "organization.getAll", { isDemo: false });

      expect(body).toMatchObject({
        error: { json: { data: { code: "UNAUTHORIZED" } } },
      });
      expect(getAllForUser).not.toHaveBeenCalled();
    });
  });
});
