import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * `/api/projects` against the real `ProjectApp`, not a stub — the stub
 * passed while production 500'd because the proxy refuses uncomposed calls.
 * Spec: specs/projects/projects-management-door.feature
 */
import type { ApiKeyVisibleProjects } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { LocalFeatureApis, ResourceScope } from "@langwatch/kernel";
import { LangyApi } from "@langwatch/langy-contract";
import { OrganizationApi, TeamNotFoundError } from "@langwatch/organization-contract";
import type { Project, ProjectWithTeam } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { ShareApi } from "@langwatch/share-contract";
import { TopicApi } from "@langwatch/topic-contract";
import { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ProjectApp } from "../../app/project.app.ts";
import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import { mountProjectRestApplication, ORGANIZATION_ID, USER_ID } from "./project.rest.harness.ts";
import { TestApiKeyService } from "./support/test-api-key-service.ts";

const OTHER_ORGANIZATION_ID = "organization-other";
const NOW = new Date("2026-09-01T00:00:00.000Z");

/**
 * The four peer applications this family never reaches — declared, never
 * bound, so a call refuses by name instead of answering quietly. AuthZ is
 * among them: this door authenticates its own credential; the browser door probes permissions.
 */
function unreachablePeers() {
  const apis = new LocalFeatureApis();
  apis.declare(OrganizationApi);
  apis.declare(ShareApi);
  apis.declare(TopicApi);
  apis.declare(AuthzApi);
  apis.declare(TraceApi);
  apis.declare(AuditLogApi);
  apis.declare(LangyApi);

  return {
    organizations: apis.reference(OrganizationApi),
    share: apis.reference(ShareApi),
    topics: apis.reference(TopicApi),
    authorization: apis.reference(AuthzApi),
    trace: apis.reference(TraceApi),
    auditLog: apis.reference(AuditLogApi),
    langy: apis.reference(LangyApi),
  };
}

function team(overrides: Partial<ProjectWithTeam["team"]> = {}): ProjectWithTeam["team"] {
  return {
    id: "team-1",
    name: "Team",
    slug: "team",
    organizationId: ORGANIZATION_ID,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
    ...overrides,
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project_1",
    name: "First Project",
    slug: "first-project",
    apiKey: "sk-lw-base-key-of-the-project",
    lwqlKey: "lwql-key",
    teamId: "team-1",
    language: "python",
    framework: "langchain",
    kind: "application",
    firstMessage: false,
    integrated: false,
    createdAt: NOW,
    updatedAt: NOW,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: null,
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    ...overrides,
  };
}

const REACHES_EVERYTHING: ApiKeyVisibleProjects = { kind: "all" };

/**
 * The application exactly as `ProjectApp.create` builds it at boot, over the
 * in-memory backing of its own repository interface, seeded with one project
 * in this organization and one in another.
 */
function application(options: { apiKeys?: Partial<TestApiKeyService> } = {}): {
  app: ProjectApp;
  database: MemoryProjectDatabase;
} {
  const database = MemoryProjectDatabase.create();
  database.putTeam(team());
  database.putTeam(team({ id: "team-other", organizationId: OTHER_ORGANIZATION_ID }));
  database.putProject(project());
  database.putProject(
    project({
      id: "project_other",
      name: "Another Organization's Project",
      slug: "another-organizations-project",
      teamId: "team-other",
    }),
  );

  const apiKeys = Object.assign(new TestApiKeyService(), {
    resolveVisibleProjects: vi.fn(async (): Promise<ApiKeyVisibleProjects> => REACHES_EVERYTHING),
    create: vi.fn(async () => ({
      token: "sk-lw-service-token",
      apiKey: { ...MINTED_KEY_ROW },
    })),
    ...options.apiKeys,
  });

  const teams = [team(), team({ id: "team-other", organizationId: OTHER_ORGANIZATION_ID })];
  const organizations = createApiFixture<OrganizationApi>({
    getTeam: async ({ teamId, organizationId }) => {
      const found = teams.find((t) => t.id === teamId && t.organizationId === organizationId);
      if (!found) throw new TeamNotFoundError(teamId);
      return found;
    },
  });

  const app = ProjectApp.create({
    dependencies: { apiKeys, ...unreachablePeers(), organizations },
    repositories: {
      projects: MemoryProjectRepository.create({ memory: database }),
    },
    members: {
      now: () => NOW.getTime(),
      // Neither member is reached on this door: the management family writes no
      // stored-object credential and reports no best-effort failure.
      encryption: { encrypt: (plaintext) => `cipher(${plaintext})` },
      logger: { error: () => undefined },
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, database };
}

/** The row the api-key boundary answers a mint with. */
const MINTED_KEY_ROW = {
  id: "api-key-service",
  name: "Fresh Project Service Key",
  description: null,
  organizationId: ORGANIZATION_ID,
  userId: null,
  createdByUserId: USER_ID,
  createdByDeviceLabel: null,
  lookupId: "lookup-1",
  permissionMode: "all",
  expiresAt: null,
  revokedAt: null,
  lastUsedAt: null,
  ingestSourceType: null,
  ingestionTemplateId: null,
  createdAt: NOW,
  updatedAt: NOW,
  roleBindings: [],
};

describe("the projects REST family over the application the composition builds", () => {
  describe("when the collection is listed", () => {
    /** @scenario "the management door reaches the application the composition built" */
    it("answers 200 with the organization's own projects", async () => {
      const { app } = application();
      const { send } = mountProjectRestApplication(app);

      const response = await send("/api/projects");

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { id: string }[] };
      expect(body.data.map((row) => row.id)).toEqual(["project_1"]);
    });
  });

  describe("when one project is read", () => {
    it("answers 200 for a project in this organization", async () => {
      const { send } = mountProjectRestApplication(application().app);

      const response = await send("/api/projects/project_1");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: "project_1" });
    });

    it("answers 404 for a project in another organization", async () => {
      const { send } = mountProjectRestApplication(application().app);

      expect((await send("/api/projects/project_other")).status).toBe(404);
    });
  });

  describe("when a project is updated", () => {
    it("writes the fields the body carried", async () => {
      const { app, database } = application();
      const { send } = mountProjectRestApplication(app);

      const response = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { name: "Renamed Project" },
      });

      expect(response.status).toBe(200);
      expect(database.findProject("project_1")?.name).toBe("Renamed Project");
    });

    /**
     * @scenario "the management door refuses to write outside its organization"
     *
     * The tenancy guard, and the reason `updateInOrganization` exists rather
     * than the door reusing `updateSettings({ projectId })`: that operation
     * resolves the organization from the PROJECT, so this request would have
     * been carried out against the other organization and answered 200.
     */
    it("refuses a project in another organization, and writes nothing", async () => {
      const { app, database } = application();
      const { send } = mountProjectRestApplication(app);

      const response = await send("/api/projects/project_other", {
        method: "PATCH",
        body: { name: "Should Not Persist" },
      });

      expect(response.status).toBe(404);
      expect(database.findProject("project_other")?.name).toBe("Another Organization's Project");
    });
  });

  describe("when a project is archived", () => {
    /** @scenario "archiving answers with the row that was archived" */
    it("answers 200 with the archived project's id, name and timestamp", async () => {
      const { app, database } = application();
      const { send } = mountProjectRestApplication(app);

      const response = await send("/api/projects/project_1", { method: "DELETE" });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        id: string;
        name: string;
        archivedAt: string | null;
      };
      expect(body.id).toBe("project_1");
      expect(body.name).toBe("First Project");
      expect(body.archivedAt).not.toBeNull();
      expect(database.findProject("project_1")?.archivedAt).not.toBeNull();
    });

    it("refuses a project in another organization, and archives nothing", async () => {
      const { app, database } = application();
      const { send } = mountProjectRestApplication(app);

      expect((await send("/api/projects/project_other", { method: "DELETE" })).status).toBe(404);
      expect(database.findProject("project_other")?.archivedAt).toBeNull();
    });
  });

  describe("when a project is provisioned", () => {
    /** @scenario "provisioning answers with a service key and never the base key" */
    it("answers 201 with the minted service key and never the base key", async () => {
      const { app } = application();
      const { send } = mountProjectRestApplication(app);

      const response = await send("/api/projects", {
        method: "POST",
        body: {
          name: "Fresh Project",
          teamId: "team-1",
          language: "typescript",
          framework: "vercel-ai",
        },
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        name: "Fresh Project",
        serviceApiKey: "sk-lw-service-token",
        serviceApiKeyId: "api-key-service",
      });
      expect(body).not.toHaveProperty("apiKey");
      expect(body).not.toHaveProperty("lwqlKey");
    });

    it("refuses a team that belongs to another organization", async () => {
      const { send } = mountProjectRestApplication(application().app);

      const response = await send("/api/projects", {
        method: "POST",
        body: {
          name: "Wrong Team",
          teamId: "team-other",
          language: "python",
          framework: "langchain",
        },
      });

      expect(response.status).toBe(400);
    });
  });
});
