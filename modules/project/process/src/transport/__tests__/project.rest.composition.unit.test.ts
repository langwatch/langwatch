/**
 * @vitest-environment node
 * `/api/projects` against the real `ProjectModule`, not a stub — the stub
 * passed while production 500'd because the proxy refuses uncomposed calls.
 * Spec: specs/projects/projects-management-door.feature
 */
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import type {
  DataPrivacyApi,
  DataPrivacyPiiRedactionLevel,
} from "@langwatch/data-privacy-contract";
import { OrganizationApi, TeamNotFoundError } from "@langwatch/organization-contract";
import { LocalFeatureApis, ResourceScope } from "@langwatch/process";
import {
  GovernanceProjectProtectedError,
  type Project,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectModule } from "../../app/project.app.ts";
import type { RecordProjectCreatedCommandData } from "../../eventing/project-lifecycle.events.ts";
import { MemoryAggregateRuleRepository } from "../../repositories/memory/memory.aggregate-rule.repository.ts";
import { MemoryProjectStorageSettingsRepository } from "../../repositories/memory/memory.project-storage-settings.repository.ts";
import { MemoryProjectDatabase } from "../../repositories/memory/memory.project.database.ts";
import { MemoryProjectRepository } from "../../repositories/memory/memory.project.repository.ts";
import { mountProjectRestApplication, ORGANIZATION_ID, USER_ID } from "./project.rest.harness.ts";

const OTHER_ORGANIZATION_ID = "organization-other";
const GOVERNANCE_PROJECT_ID = "project_governance";
const NOW = new Date("2026-09-01T00:00:00.000Z");

/**
 * The four peer applications this family never reaches — declared, never
 * bound, so a call refuses by name instead of answering quietly. AuthZ is
 * among them: this door authenticates its own credential; the browser door probes permissions.
 */
function unreachablePeers() {
  const apis = new LocalFeatureApis();
  apis.declare(OrganizationApi);
  apis.declare(AuthzApi);
  apis.declare(AuditLogApi);

  return {
    organizations: apis.reference(OrganizationApi),
    authorization: apis.reference(AuthzApi),
    auditLog: apis.reference(AuditLogApi),
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

/**
 * The application exactly as `ProjectModule.create` builds it at boot, over the
 * in-memory backing of its own repository interface, seeded with one project
 * in this organization and one in another.
 */
function application(): {
  app: ProjectModule;
  database: MemoryProjectDatabase;
} {
  const database = MemoryProjectDatabase.create();
  database.putTeam(team());
  database.putTeam(team({ id: "team-other", organizationId: OTHER_ORGANIZATION_ID }));
  database.putProject(project());
  database.putProject(
    project({
      id: GOVERNANCE_PROJECT_ID,
      name: "Governance (internal)",
      slug: "governance-organization-1",
      kind: "internal_governance",
    }),
  );
  database.putProject(
    project({
      id: "project_other",
      name: "Another Organization's Project",
      slug: "another-organizations-project",
      teamId: "team-other",
    }),
  );

  const teams = [team(), team({ id: "team-other", organizationId: OTHER_ORGANIZATION_ID })];
  const organizations = createApiFixture<OrganizationApi>({
    getTeam: async ({ teamId, organizationId }) => {
      const found = teams.find((t) => t.id === teamId && t.organizationId === organizationId);
      if (!found) throw new TeamNotFoundError(teamId);
      return found;
    },
  });

  let piiRedactionLevel: DataPrivacyPiiRedactionLevel = "ESSENTIAL";
  const dataPrivacy = createApiFixture<DataPrivacyApi>({
    getPiiRedactionLevel: async () => piiRedactionLevel,
    setPiiRedactionLevel: async ({ level }) => {
      piiRedactionLevel = level;
    },
  });

  const app = ProjectModule.create({
    dependencies: { ...unreachablePeers(), organizations, dataPrivacy },
    repositories: {
      projects: MemoryProjectRepository.create({ memory: database }),
      storageSettings: MemoryProjectStorageSettingsRepository.create({ memory: database }),
      aggregateRules: MemoryAggregateRuleRepository.create({ memory: database }),
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  return { app, database };
}

describe("the projects REST family over the application the composition builds", () => {
  describe("when the organization's projects are listed for the management door", () => {
    it("answers the organization's own projects", async () => {
      const { app } = application();

      const page = await app.listByOrganization({
        organizationId: ORGANIZATION_ID,
        page: 1,
        limit: 50,
      });

      expect(page.data.map((row) => row.id)).toEqual(["project_1"]);
    });

    /** @scenario "The hidden Governance Project never appears in /api/v1/projects responses" */
    it("carries no trace of the hidden governance project, in a row or in a count", async () => {
      const { app } = application();

      const page = await app.listByOrganization({
        organizationId: ORGANIZATION_ID,
        page: 1,
        limit: 50,
      });

      const text = JSON.stringify(page);
      expect(text).not.toContain(GOVERNANCE_PROJECT_ID);
      expect(text).not.toContain("Governance (internal)");
      expect(text).not.toContain("internal_governance");
      expect(page.pagination.total).toBe(1);
    });
  });

  describe("when one project is read", () => {
    it("answers 200 for a project in this organization", async () => {
      const { send } = mountProjectRestApplication(application().app);

      const response = await send("/api/projects/project_1");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: "project_1" });
    });

    /** @scenario "Reading a project answers its PII redaction level" */
    it("answers the level data privacy holds for the project", async () => {
      const { send } = mountProjectRestApplication(application().app);

      const response = await send("/api/projects/project_1");

      await expect(response.json()).resolves.toMatchObject({ piiRedactionLevel: "ESSENTIAL" });
    });

    it("answers 404 for a project in another organization", async () => {
      const { send } = mountProjectRestApplication(application().app);

      expect((await send("/api/projects/project_other")).status).toBe(404);
    });
  });

  describe("when a project is created", () => {
    const recorded = vi.fn(async (_data: RecordProjectCreatedCommandData) => undefined);
    let app: ReturnType<typeof application>["app"];

    beforeEach(() => {
      recorded.mockClear();
      app = application().app;
      app.connectLifecycle({
        recordProjectCreated: { send: recorded },
        recordProjectLegacyKeyRevoked: { send: async () => undefined },
        recordPresenceSettingChanged: { send: async () => undefined },
        recordProjectMoved: { send: async () => undefined },
        recordProjectArchived: { send: async () => undefined },
        recordProjectDepartmentAssigned: { send: async () => undefined },
        recordProjectTraceSharingDisabled: { send: async () => undefined },
      });
    });

    /** @scenario "A project created through the REST API is recorded as created" */
    it("records one provisioned through createInOrganization, as the REST door does", async () => {
      const created = await app.createInOrganization({
        organizationId: ORGANIZATION_ID,
        userId: null,
        teamId: "team-1",
        name: "Fresh Project",
        language: "python",
        framework: "other",
      });

      expect(recorded).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: created.id,
          projectId: created.id,
          organizationId: ORGANIZATION_ID,
        }),
      );
    });

    /** @scenario "A project created from the projects screen is recorded as created" */
    /** @scenario "The first project created during onboarding is recorded as created" */
    it("records one made through ProjectApi.create, as the screen and onboarding do", async () => {
      const created = await app.create(
        {
          organizationId: ORGANIZATION_ID,
          teamId: "team-1",
          name: "First Project",
          language: "python",
          framework: "other",
        },
        { id: USER_ID },
      );

      expect(recorded).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: created.id, organizationId: ORGANIZATION_ID }),
      );
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

    /** @scenario "Updating a project's PII redaction level writes it through data privacy" */
    it("writes the level through data privacy and reads it back", async () => {
      const { send } = mountProjectRestApplication(application().app);

      const patched = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { name: "Renamed Project", piiRedactionLevel: "STRICT" },
      });

      expect(patched.status).toBe(200);
      await expect(patched.json()).resolves.toMatchObject({
        name: "Renamed Project",
        piiRedactionLevel: "STRICT",
      });
      await expect((await send("/api/projects/project_1")).json()).resolves.toMatchObject({
        piiRedactionLevel: "STRICT",
      });
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

  describe("when a project is provisioned into another organization's team", () => {
    it("refuses by name and creates nothing", async () => {
      const { app } = application();

      await expect(
        app.createInOrganization({
          organizationId: ORGANIZATION_ID,
          userId: USER_ID,
          teamId: "team-other",
          name: "Wrong Team",
          language: "python",
          framework: "langchain",
        }),
      ).rejects.toMatchObject({ code: "team_not_in_organization" });
      for (const organizationId of [ORGANIZATION_ID, OTHER_ORGANIZATION_ID]) {
        const page = await app.listByOrganization({ organizationId, page: 1, limit: 50 });
        expect([organizationId, page.pagination.total]).toEqual([organizationId, 1]);
      }
    });
  });

  describe("given the hidden governance project", () => {
    /** @scenario Reading the governance area by its id reports it as absent */
    it("reads as not found, as a project in another organization does", async () => {
      const { send } = mountProjectRestApplication(application().app);

      expect((await send(`/api/projects/${GOVERNANCE_PROJECT_ID}`)).status).toBe(404);
    });

    /** @scenario The governance area cannot be archived through the projects API */
    it("refuses an archive with 403 and leaves it live", async () => {
      const { app, database } = application();
      const { send } = mountProjectRestApplication(app);

      const response = await send(`/api/projects/${GOVERNANCE_PROJECT_ID}`, { method: "DELETE" });

      expect(response.status).toBe(403);
      expect(JSON.stringify(await response.json())).toContain("internal governance record");
      expect(database.findProject(GOVERNANCE_PROJECT_ID)?.archivedAt).toBeNull();
    });

    /** @scenario The governance area cannot be renamed or moved through the projects API */
    it("refuses a rename with 403 and writes nothing", async () => {
      const { app, database } = application();
      const { send } = mountProjectRestApplication(app);

      const response = await send(`/api/projects/${GOVERNANCE_PROJECT_ID}`, {
        method: "PATCH",
        body: { name: "Renamed" },
      });

      expect(response.status).toBe(403);
      expect(database.findProject(GOVERNANCE_PROJECT_ID)?.name).toBe("Governance (internal)");
    });

    /** @scenario The governance area cannot be re-keyed through the projects API */
    it("refuses a new key over REST and over the browser door, leaving its key as it was", async () => {
      const { app, database } = application();
      const { send } = mountProjectRestApplication(app);
      const keyBefore = database.findProject(GOVERNANCE_PROJECT_ID)?.apiKey;

      const rest = await send(`/api/projects/${GOVERNANCE_PROJECT_ID}/regenerate-api-key`, {
        method: "POST",
        body: {},
      });
      const browser = await app
        .revokeProjectApiKey({ projectId: GOVERNANCE_PROJECT_ID, by: { id: USER_ID } })
        .catch((error: unknown) => error);

      expect(rest.status).toBe(403);
      expect(browser).toBeInstanceOf(GovernanceProjectProtectedError);
      expect(database.findProject(GOVERNANCE_PROJECT_ID)?.apiKey).toBe(keyBefore);
    });

    /** @scenario An ordinary project is unaffected by the guard */
    it("still renames, reads and archives an ordinary project beside it", async () => {
      const { send } = mountProjectRestApplication(application().app);

      const renamed = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { name: "Renamed" },
      });
      const read = await send("/api/projects/project_1");
      const archived = await send("/api/projects/project_1", { method: "DELETE" });

      expect([renamed.status, read.status, archived.status]).toEqual([200, 200, 200]);
    });
  });
});
