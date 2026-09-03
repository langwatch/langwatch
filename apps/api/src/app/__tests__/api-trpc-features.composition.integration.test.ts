/**
 * The packaged tRPC record, served by the API process.
 *
 * What this pins is the seam the migration turns on: `createAppTrpcFeatures`
 * built on THIS process's root, with THIS process's policy chain, reachable
 * over the real `/api/trpc` handler. The four calls are one per kind of port
 * the composition answers, not one per namespace — a namespace is either in the
 * record or it does not exist, and the first assertion is what checks that.
 *
 *   dashboards.getAll  an application slice read off `ctx.app`, behind a
 *                      DECLARED permission, so the whole chain runs.
 *   workflow.getAll    a row read the composition lifted onto this process's
 *                      own Prisma connection, plus the AuthZ probe beside it.
 *   bugReports.getAll  a collaborator read, with the audit row this process
 *                      writes before the caller sees the transcript.
 *   publicEnv          the signed-out door, on the PUBLIC procedure.
 */
import { AuthApp } from "@langwatch/auth-server";
import type {
  AuthzGetDecisionInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiApplication } from "../../api.application";
import { ApiAuditPort } from "../../api-request.policy";
import type { AnyApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import {
  ApiTrpcFeaturesComposition,
  LoggedApiTrpcFeaturesAbsence,
} from "../api-trpc-features.composition";

/**
 * The namespaces `createAppTrpcFeatures` mounts, as the wire names them.
 *
 * Written out rather than derived from the record under test: derived, the
 * assertion would pass for whatever the record happened to contain, including
 * a record that had silently lost half its surfaces.
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
 * A collaborator group with only the members the record reads while it is being
 * BUILT — the input schemas, and the one decorator a rollout gate applies to a
 * procedure. Everything else answers a function that refuses by name when a
 * call actually reaches it.
 *
 * The split matters: a router is assembled at composition time, so a schema
 * that refused on property access would fail the mount rather than the call,
 * and a test would be unable to tell a missing port from an unexercised one.
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
const openGate = <TProcedure>(procedure: TProcedure): TProcedure => procedure;

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

const bugReportPage = { items: [{ id: "report-1" }], total: 1 };

function testPrisma() {
  const findMany = vi.fn(async () => [workflowRow]);
  return {
    client: { workflow: { findMany } } as unknown as PrismaClient,
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

function testApplication(): ApiTrpcFeatureApplication {
  return {
    ...stub<ApiTrpcFeatureApplication>("app"),
    dashboard: {
      getAll: async () => [dashboardRow],
    },
    ops: { isAdmin: () => true },
    monitors: stub("app.monitors"),
    storedObjectApp: stub("app.storedObjectApp"),
    config: { opsSidebarEmails: ["staff@langwatch.ai"] },
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

function testCollaborators(): AnyApiTrpcCollaborators {
  return {
    application: testApplication(),
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
    bugReports: {
      getAll: async () => bugReportPage,
      getById: async () => null,
    },
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
    dataRetention: stub("dataRetention"),
    monitors: stub("monitors", { preconditionsSchema: anySchema }),
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
    // The virtual-key budget parser and the SaaS-billing decision, stubbed
    // with only what the record reads while it is BUILT. Their own suite is
    // what proves they answer.
    gateway: { virtualKeys: { virtualKeyBudgetInput: anySchema } },
    governanceHome: stub("governanceHome"),
    saasBilling: false,
    github: stub("github"),
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
  overrides: {
    session?: { user: { id: string; email?: string | null; role?: string | null } } | null;
  } = {},
) {
  const prisma = testPrisma();
  const audit = new RecordingAudit();
  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: prisma.client } as unknown as PrismaConnection,
    authz: testAuthz(),
    audit,
    collaborators: testCollaborators(),
  });
  if (!features) throw new Error("the record refused to compose against its test collaborators");

  const session =
    overrides.session === undefined
      ? { user: { id: "user-1", email: "staff@langwatch.ai", role: "ADMIN" } }
      : overrides.session;

  const application = ApiApplication.create({
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
      database: { client: {} as unknown as PrismaClient } as unknown as PrismaConnection,
      authz: testAuthz(),
      audit: undefined,
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
      http: { createContext: async () => ({ actor: () => ({ id: "user-1" }), authorize: async () => undefined }) },
    });

    const mounted = Object.keys(
      (application.trpc as unknown as { _def: { record: Record<string, unknown> } })._def.record,
    );

    expect(mounted).not.toContain("dashboards");
  });
});

describe("given a process with a database but no AuthZ service", () => {
  it("refuses the record rather than mounting authorized surfaces over nothing", () => {
    const warn = vi.fn();

    const features = ApiTrpcFeaturesComposition.tryCompose({
      database: { client: {} as unknown as PrismaClient } as unknown as PrismaConnection,
      authz: undefined,
      audit: undefined,
      collaborators: testCollaborators(),
      report: LoggedApiTrpcFeaturesAbsence.create({ warn }),
    });

    expect(features).toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ reason: "no-database" }, expect.any(String));
  });
});
