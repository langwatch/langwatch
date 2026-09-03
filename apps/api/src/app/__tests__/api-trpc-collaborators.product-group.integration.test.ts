/**
 * The product-group half of the packaged tRPC record, served by the API
 * process.
 *
 * What this pins is one call per namespace this half mounts, each of them made
 * over the REAL `/api/trpc` handler on THIS process's root, through THIS
 * process's policy chain, against the collaborator set
 * `composeApiProductGroupCollaborators` produced. Nothing here reaches a stub
 * through a proxy: the fakes are at the PORTS — a Prisma double and an AuthZ
 * service — and everything between the HTTP request and them is the real
 * composed graph.
 *
 *   authz.effectivePermissions          the caller's own standing, off the SAME
 *                                       AuthZ service the declared check ran on
 *   batchRecord.getAllByexperimentIdGroup
 *                                       the batch-evaluation rollup, read off
 *                                       this process's own connection
 *   dataset.getAll                      the SAME dataset service the execution
 *                                       half's workflow application reads rows
 *                                       through
 *   evaluators.getAll                   the SAME evaluator service the workflow
 *                                       application publishes evaluators through
 *   role.getAll                         the composed role application, over the
 *                                       registry's own permission vocabulary
 *   featureFlag.isEnabled               the real `PostgresFeatureFlagAdapter`
 *                                       over a flag row, including the
 *                                       project → organization resolution the
 *                                       package's own resolver authorizes with
 *   home.getRecentItems                 the MOVED recent-items service: the
 *                                       audit-trail read and the entity
 *                                       hydration that turns a row into the
 *                                       name and link the strip renders
 *   personalWorkspaceFeatures.get       the organization application, off
 *                                       `ctx.app`
 *   promptTags.getAll                   the real `PostgresPromptAdapter`'s tag
 *                                       catalogue, resolved through the
 *                                       project's organization
 *   team.getTeamsWithMembers            the `probeOrganizationPermission` port,
 *                                       which widens what each member row shows
 *
 * And one named absence, because an absence nobody can observe is
 * indistinguishable from a stub: with no Enterprise plan gate composed, a
 * member list that assigns a CUSTOM role is refused by name rather than
 * permitted.
 */
import type {
  AuthzGetDecisionInput,
  AuthzGrantsService,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PostgresDatasetAdapter } from "@langwatch/dataset-server";
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiApplication } from "../../api.application";
import type { AnyApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import { ApiTrpcFeaturesComposition } from "../api-trpc-features.composition";
import {
  composeApiProductGroupCollaborators,
  withApiProductGroupCollaborators,
} from "../api-trpc-collaborators.product-group.composition";

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
 * the record is being BUILT. It carries no authorization declaration because
 * nothing in this file exercises a trace-group procedure.
 */
const passThroughMiddleware = ({ next }: { next: () => unknown }) => next();

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";

/**
 * The rows this half actually reads, as a double.
 *
 * A double rather than a database, and every model here is one a REAL composed
 * adapter reaches: the flag row `PostgresFeatureFlagAdapter` looks up, the
 * audit trail and prompt row the moved recent-items service walks, and the
 * organization behind a prompt tag catalogue.
 */
function testPrisma() {
  const auditEntries = [
    {
      id: "audit-1",
      action: "prompts.create",
      args: { configId: "prompt-1" },
      createdAt: new Date("2026-09-01T10:00:00Z"),
    },
  ];

  const client = {
    featureFlag: {
      findUnique: vi.fn(async () => ({
        key: "release_ui_ai_gateway_menu_enabled",
        enabled: true,
        rules: [],
        updatedAt: new Date("2026-09-01T09:00:00Z"),
      })),
      findMany: vi.fn(async () => []),
    },
    auditLog: { findMany: vi.fn(async () => auditEntries) },
    llmPromptConfig: {
      findFirst: vi.fn(async () => ({
        id: "prompt-1",
        name: "Support triage",
        deletedAt: null,
        updatedAt: new Date("2026-09-01T10:00:00Z"),
        projectId: PROJECT_ID,
        project: { slug: "acme" },
      })),
    },
    promptTag: { findMany: vi.fn(async () => []) },
    customRole: {
      findMany: vi.fn(async () => [
        {
          id: "role-1",
          organizationId: ORGANIZATION_ID,
          name: "Auditor",
          description: null,
          permissions: ["project:view"],
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
          updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        },
      ]),
    },
    dataset: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [
        {
          id: "dataset-1",
          name: "Golden set",
          slug: "golden-set",
          projectId: PROJECT_ID,
          columnTypes: [],
          archivedAt: null,
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
          updatedAt: new Date("2026-09-01T00:00:00.000Z"),
          _count: { datasetRecords: 4 },
        },
      ]),
      count: vi.fn(async () => 1),
    },
    batchEvaluation: {
      groupBy: vi.fn(async () => [
        { experimentId: "experiment-1", datasetSlug: "golden-set", _count: { experimentId: 3 } },
      ]),
      findMany: vi.fn(async () => []),
    },
    workflow: { findFirst: vi.fn(async () => null) },
    monitor: { findFirst: vi.fn(async () => null) },
    annotationQueue: { findFirst: vi.fn(async () => null) },
  } as unknown as PrismaClient;

  const held = client as unknown as {
    auditLog: { findMany: ReturnType<typeof vi.fn> };
    batchEvaluation: { groupBy: ReturnType<typeof vi.fn> };
  };
  return { client, auditLog: held.auditLog, batchEvaluation: held.batchEvaluation };
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
    listUserCreatedRoles: async () => [
      {
        id: "role-1",
        organizationId: ORGANIZATION_ID,
        name: "Auditor",
        description: null,
        permissions: ["project:view"],
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    ],
    tryResolveScope: async (input: { projectId?: string; organizationId?: string }) =>
      input.projectId
        ? { type: "project", id: input.projectId }
        : input.organizationId
          ? { type: "organization", id: input.organizationId }
          : null,
    effectivePermissions: async () => ["project:view", "prompts:view"],
  } as unknown as AuthzService;
}

/**
 * The rest of the record, stubbed: this file describes the product-group half,
 * and a namespace it does not own answering a call would mean the test had
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
    // The three product-infrastructure surfaces, as one entry. Only the
    // monitor precondition parser is read while the record is BUILT; the
    // retention policy and the rest refuse by name if a call reaches them.
    dataRetention: stub("dataRetention"),
    monitors: stub("monitors", { preconditionsSchema: anySchema }),
    /**
     * The trace group, stubbed with only what the record reads while it is
     * being BUILT: the input schemas its procedures are parsed with. Its own
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
        // Both are read at BUILD time — the mount wraps a procedure in each —
        // so they answer a pass-through middleware rather than refusing.
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
    /**
     * The twenty-one gateway and governance surfaces, stubbed with only what
     * the record reads while it is BUILT: the virtual-key budget parser and
     * the SaaS-billing decision, which chooses which router the two billing
     * namespaces ARE. Their own suite is what proves they answer.
     */
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

/**
 * The organization application the identity half owns, as the two surfaces
 * that read it off `ctx.app` ask it. Supplied by the BASE rather than by this
 * half on purpose — see `withApiProductGroupCollaborators`.
 */
function testOrganizationApp() {
  return {
    isMember: vi.fn(async () => true),
    getPersonalWorkspaceFeatures: vi.fn(async () => ({ enabled: true })),
    listTeamsWithMembers: vi.fn(async () => [{ id: "team-1", name: "Platform", members: [] }]),
    listProjectsByOrganization: vi.fn(async () => ({ data: [], nextCursor: null })),
  };
}

function composeApplication(options: { customRolePlan?: undefined } = {}) {
  const prisma = testPrisma();
  const authz = testAuthz();
  const organizations = testOrganizationApp();

  const projects = {
    getOrganizationId: vi.fn(async () => ORGANIZATION_ID),
  } as unknown as ProjectService;

  const datasets = PostgresDatasetAdapter.create({ database: prisma.client }).build();

  const group = composeApiProductGroupCollaborators({
    prisma: prisma.client,
    authz,
    evaluators: {
      getAllWithFields: vi.fn(async () => [
        { id: "evaluator-1", name: "Toxicity", projectId: PROJECT_ID },
      ]),
    } as never,
    workflows: {} as never,
    grants: {
      attachBindings: vi.fn(async () => undefined),
      invalidateOrganization: vi.fn(async () => undefined),
    } as unknown as AuthzGrantsService,
    organizations: {} as unknown as OrganizationService,
    projects,
    featureFlags: { overrides: new Map(), forceEnabled: new Set() },
    // The REAL dataset service, over the same double: what this pins is that
    // `dataset.*` answers from the service the execution half composed rather
    // than from a second one built here.
    datasets,
    experimentLookup: {
      getById: async () => ({ name: null }),
      tryGetBySlug: async () => null,
    },
    ...options,
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: prisma.client } as unknown as PrismaConnection,
    authz,
    audit: undefined,
    collaborators: withApiProductGroupCollaborators(baseCollaborators(organizations), group),
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

  return { application, prisma, authz, organizations, projects, group };
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

describe("given an API process composed with the product-group half of the record", () => {
  describe("when the caller asks what they may do at a scope", () => {
    it("answers from the same AuthZ service the declared check ran on", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "authz.effectivePermissions", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: {
          data: {
            json: {
              scope: { type: "project", id: PROJECT_ID },
              permissions: ["project:view", "prompts:view"],
            },
          },
        },
      });
    });
  });

  describe("when the browser asks whether a rollout is on for a project", () => {
    it("resolves the project's organization and reads the flag row through the composed adapter", async () => {
      const { application, projects } = composeApplication();

      const { status, body } = await callTrpc(application, "featureFlag.isEnabled", {
        flag: "release_ui_ai_gateway_menu_enabled",
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { enabled: true } } } });
      expect(projects.getOrganizationId).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  describe("when a project lists its datasets", () => {
    it("answers from the same dataset service the execution half composed", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "dataset.getAll", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: [{ id: "dataset-1", name: "Golden set" }] } },
      });
    });
  });

  describe("when the experiments page asks for its batch-evaluation rollup", () => {
    it("reads the table off this process's own connection", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(
        application,
        "batchRecord.getAllByexperimentIdGroup",
        { projectId: PROJECT_ID },
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: [{ experimentId: "experiment-1" }] } },
      });
      expect(prisma.batchEvaluation.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: PROJECT_ID } }),
      );
    });
  });

  describe("when the home screen asks for what this person recently touched", () => {
    it("walks the process's own audit trail and hydrates each entity it names", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "home.getRecentItems", {
        projectId: PROJECT_ID,
        limit: 12,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: {
          data: {
            json: [
              {
                id: "prompt-1",
                type: "prompt",
                name: "Support triage",
                href: "/acme/prompts?prompt=prompt-1",
              },
            ],
          },
        },
      });
      // The trail is read as THIS person's, in THIS project: a blank user id
      // would widen the read to somebody else's activity rather than refuse it.
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: SESSION_USER.id, projectId: PROJECT_ID }),
        }),
      );
    });
  });

  describe("when a personal workspace asks which features it may switch on", () => {
    it("reads the organization application the identity half composed", async () => {
      const { application, organizations } = composeApplication();

      const { status, body } = await callTrpc(application, "personalWorkspaceFeatures.get", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { enabled: true } } } });
      expect(organizations.getPersonalWorkspaceFeatures).toHaveBeenCalledWith(
        { projectId: PROJECT_ID },
        { id: SESSION_USER.id },
      );
    });
  });

  describe("when a project reads its organization's prompt tag catalogue", () => {
    it("answers through the composed prompt application", async () => {
      const { application, projects } = composeApplication();

      const { status, body } = await callTrpc(application, "promptTags.getAll", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: [] } } });
      expect(projects.getOrganizationId).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  describe("when the evaluators screen lists a project's evaluators", () => {
    it("answers from the same evaluator service the execution half composed", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "evaluators.getAll", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: [{ id: "evaluator-1", name: "Toxicity" }] } },
      });
    });
  });

  describe("when a workflow evaluator is replicated without a saved graph version", () => {
    it("refuses rather than writing a structurally broken replica", async () => {
      const { group } = composeApplication();

      await expect(
        group.evaluatorPorts.replicateEvaluatorWorkflow({} as never, {
          workflowId: "workflow-1",
          sourceProjectId: PROJECT_ID,
          targetProjectId: "project-2",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("when the roles screen lists an organization's custom roles", () => {
    it("answers through the composed role application", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "role.getAll", {
        organizationId: ORGANIZATION_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: [{ id: "role-1", name: "Auditor" }] } },
      });
    });
  });

  describe("when no Enterprise plan gate is composed and a custom role is defined", () => {
    it("refuses by name rather than storing a role the plan does not carry", async () => {
      const { group } = composeApplication();

      await expect(
        group.rolePorts.assertCustomRolePlan({} as never, { organizationId: ORGANIZATION_ID }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });
  });

  describe("when the team screen lists an organization's teams", () => {
    it("passes the caller's administration standing to the service that widens each row", async () => {
      const { application, organizations, authz } = composeApplication();

      const { status } = await callTrpc(application, "team.getTeamsWithMembers", {
        organizationId: ORGANIZATION_ID,
      });

      expect(status).toBe(200);
      expect(organizations.listTeamsWithMembers).toHaveBeenCalled();
      expect(authz.hasPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: SESSION_USER.id,
          organizationId: ORGANIZATION_ID,
        }),
      );
    });
  });

  describe("when no Enterprise plan gate is composed", () => {
    it("refuses a member list that assigns a custom role, by name", async () => {
      const { group } = composeApplication();

      await expect(
        group.teamPorts.assertCustomRolesAllowed({} as never, {
          organizationId: ORGANIZATION_ID,
          members: [{ role: "role_abc123" }],
        }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });

    it("leaves a member list carrying only built-in roles alone", async () => {
      const { group } = composeApplication();

      await expect(
        group.teamPorts.assertCustomRolesAllowed({} as never, {
          organizationId: ORGANIZATION_ID,
          members: [{ role: "MEMBER" }, { role: "ADMIN" }],
        }),
      ).resolves.toBeUndefined();
    });
  });
});
