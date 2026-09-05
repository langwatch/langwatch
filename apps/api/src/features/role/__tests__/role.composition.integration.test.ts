/**
 * The role, team and home features, served by the API process beside the four
 * product features they mount with.
 */
import type {
  AuthzGetDecisionInput,
  AuthzGrantsService,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { PostgresDatasetAdapter } from "@langwatch/dataset-server";
import type { ProjectService } from "@langwatch/project-contract";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  ApiApplication,
  MissingAgentService,
  MissingSecretService,
} from "../../../api.application";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition";
import { composeFeatureFlagFeature } from "../../feature-flag/feature-flag.composition";
import { composeDatasetFeature } from "../../dataset/dataset.composition";
import { composeEvaluatorFeature } from "../../evaluator/evaluator.composition";
import { composePromptFeature } from "../../prompt/prompt.composition";
import { composeHomeFeature } from "../../project/home.composition";
import { composeRoleFeature } from "../role.composition";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles";

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";

/**
 * The rows this half actually reads, as a double.
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
      create: vi.fn(async () => ({ id: "role-2" })),
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
 * The organization application the identity half owns, as the two surfaces
 * that read it off `ctx.app` ask it. Supplied by the BASE rather than by this
 * half on purpose — see `composeApiTrpcCollaborators`.
 */
function testOrganizationApp() {
  return {
    isMember: vi.fn(async () => true),
    getPersonalWorkspaceFeatures: vi.fn(async () => ({ enabled: true })),
    listTeamsWithMembers: vi.fn(async () => [{ id: "team-1", name: "Platform", members: [] }]),
    listProjectsByOrganization: vi.fn(async () => ({ data: [], nextCursor: null })),
    createTeamWithMembers: vi.fn(async () => ({ id: "team-2", name: "Platform" })),
  };
}

function composeApplication(options: { customRolePlan?: undefined } = {}) {
  const prisma = testPrisma();
  const authz = testAuthz();
  const organizations = testOrganizationApp();
  const broadcast = new EventEmitter();

  const projects = {
    getOrganizationId: vi.fn(async () => ORGANIZATION_ID),
  } as unknown as ProjectService;

  const datasets = PostgresDatasetAdapter.create({ database: prisma.client }).build();

  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: prisma.client,
    authz,
    audit: undefined,
  };

  const evaluators = {
    getAllWithFields: vi.fn(async () => [
      { id: "evaluator-1", name: "Toxicity", projectId: PROJECT_ID },
    ]),
  } as never;

  // The three features that moved out of this half, composed the way the root
  // composes them and handed in beside it.
  const dataset = composeDatasetFeature({
    infrastructure,
    peers: {
      // The REAL dataset service, over the same double: what this pins is that
      // `dataset.*` answers from the service the execution half composed rather
      // than from a second one built here.
      datasets,
      experimentLookup: {
        getById: async () => ({ name: null }),
        tryGetBySlug: async () => null,
      },
    },
  });
  const evaluator = composeEvaluatorFeature({
    infrastructure,
    peers: { evaluators, workflows: {} as never },
  });
  const prompt = composePromptFeature({ infrastructure, peers: { projects } });

  const featureFlag = composeFeatureFlagFeature({
    prisma: prisma.client,
    config: { overrides: new Map(), forceEnabled: new Set() },
  });
  const role = composeRoleFeature({
    infrastructure,
    grants: {
      attachBindings: vi.fn(async () => undefined),
      invalidateOrganization: vi.fn(async () => undefined),
    } as unknown as AuthzGrantsService,
    ...options,
  });
  const home = composeHomeFeature({ infrastructure });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: { ...stubComposedFeatures(), dataset, evaluator, prompt, featureFlag, home, role },
    infrastructure,
    collaborators: stubCollaborators(
      {
        // `application.projects` is the project feature's in production, so the
        // slice here has to carry the SAME `projects` this test observes, or
        // the flag resolution reads a different project directory than the one
        // it asserts against. The slice is the project APPLICATION in
        // production; this suite drives only the directory behind it.
        projects: projects as never,
        // The organization application the identity half composed: the personal
        // workspace read and both team calls answer off THIS slice.
        organizations: organizations as never,
        dataset: dataset.app,
        evaluatorApp: evaluator.app,
        prompts: prompt.app,
        featureFlags: featureFlag.service,
        authzApp: role.authzApp,
        permissions: authz,
        roles: role.app,
      },
      broadcast,
    ),
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

  return { application, prisma, authz, organizations, projects, evaluator };
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

describe("given an API process composed with the role, team and home features", () => {
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
      const { evaluator } = composeApplication();

      await expect(
        evaluator.ports.replicateEvaluatorWorkflow({} as never, {
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
      const { application, prisma } = composeApplication();

      const { body } = await callTrpc(
        application,
        "role.create",
        { organizationId: ORGANIZATION_ID, name: "Auditor", permissions: [] },
        "mutation",
      );

      expect(JSON.stringify(body)).toContain("service_unavailable");
      expect(prisma.client.customRole.create).not.toHaveBeenCalled();
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
      const { application, organizations } = composeApplication();

      const { body } = await callTrpc(
        application,
        "team.createTeamWithMembers",
        {
          organizationId: ORGANIZATION_ID,
          name: "Platform",
          members: [{ userId: "user-2", role: "custom:role_abc123", customRoleId: "role-1" }],
        },
        "mutation",
      );

      expect(JSON.stringify(body)).toContain("service_unavailable");
      expect(organizations.createTeamWithMembers).not.toHaveBeenCalled();
    });

    it("leaves a member list carrying only built-in roles alone", async () => {
      const { application, organizations } = composeApplication();

      const { status } = await callTrpc(
        application,
        "team.createTeamWithMembers",
        {
          organizationId: ORGANIZATION_ID,
          name: "Platform",
          members: [{ userId: "user-2", role: "MEMBER" }],
        },
        "mutation",
      );

      expect(status).toBe(200);
      expect(organizations.createTeamWithMembers).toHaveBeenCalled();
    });
  });
});
