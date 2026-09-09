/**
 * @vitest-environment node
 * The `/api/projects` REST door: input validation, the access each route
 * declares, the status a domain refusal becomes, and the wire body. What the
 * domain decides belongs to the service's own tests, not here.
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 *       specs/api-keys/project-key-read-access.feature
 */
import type { ApiKey, ApiKeyVisibleProjects } from "@langwatch/api-key-contract";
import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type PaginatedProjects,
  type Project,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import {
  API_KEY_ID,
  mountProjectRest,
  ORGANIZATION_ID,
  USER_ID,
} from "./project.rest.harness.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "project_1",
    name: "My Test Project",
    slug: "my-test-project",
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

function projectWithTeam(overrides: Partial<ProjectWithTeam> = {}): ProjectWithTeam {
  return {
    ...project(),
    team: {
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
    },
    ...overrides,
  };
}

function page(data: Project[], total = data.length): PaginatedProjects {
  return { data, pagination: { page: 1, limit: 50, total } };
}

/** The service key the door mints alongside a new project. */
function mintedServiceKey(): { token: string; apiKey: ApiKey } {
  return {
    token: "sk-lw-service-token",
    apiKey: {
      id: "api-key-service",
      name: "My Test Project Service Key",
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
    },
  };
}

/** The visibility answer a credential whose reach is the whole organization gets. */
const SEES_EVERYTHING: ApiKeyVisibleProjects = { kind: "all" };

describe("the projects REST family", () => {
  describe("given no credential", () => {
    it("refuses before the request reaches the service", async () => {
      const listByOrganization = vi.fn(async () => page([]));
      const { hono } = mountProjectRest({ projects: { listByOrganization } });

      const response = await hono.request("/api/projects");

      expect(response.status).toBe(401);
      expect(listByOrganization).not.toHaveBeenCalled();
    });

    it("refuses a credential it does not recognise", async () => {
      const { send } = mountProjectRest();

      const response = await send("/api/projects", { credential: "sk-lw-invalid_token" });

      expect(response.status).toBe(401);
    });
  });

  describe("when a project is provisioned", () => {
    it("returns the project with a freshly minted service key and no base key", async () => {
      const create = vi.fn(async () => project());
      const mint = vi.fn(async () => mintedServiceKey());
      const { send } = mountProjectRest({ projects: { create }, apiKeys: { create: mint } });

      const response = await send("/api/projects", {
        method: "POST",
        body: {
          name: "My Test Project",
          teamId: "team-1",
          language: "python",
          framework: "langchain",
        },
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        id: "project_1",
        name: "My Test Project",
        slug: "my-test-project",
        teamId: "team-1",
        language: "python",
        framework: "langchain",
        serviceApiKey: "sk-lw-service-token",
        serviceApiKeyId: "api-key-service",
      });
      expect(body).not.toHaveProperty("apiKey");
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, userId: USER_ID }),
      );
      expect(mint).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          createdByUserId: USER_ID,
          organizationId: ORGANIZATION_ID,
          bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: "project_1" }],
        }),
      );
    });

    it("provisions into a new team when the request names one instead of an id", async () => {
      const create = vi.fn(async () => project({ teamId: "team-new" }));
      const mint = vi.fn(async () => mintedServiceKey());
      const { send } = mountProjectRest({ projects: { create }, apiKeys: { create: mint } });

      const response = await send("/api/projects", {
        method: "POST",
        body: {
          name: "New Team Project",
          newTeamName: "API Team",
          language: "typescript",
          framework: "vercel-ai",
        },
      });

      expect(response.status).toBe(201);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ newTeamName: "API Team", teamId: undefined }),
      );
    });

    it("refuses a body with no name", async () => {
      const create = vi.fn(async () => project());
      const { send } = mountProjectRest({ projects: { create } });

      const response = await send("/api/projects", {
        method: "POST",
        body: { teamId: "team-1", language: "python", framework: "langchain" },
      });

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses a body that names neither an existing team nor a new one", async () => {
      const create = vi.fn(async () => project());
      const { send } = mountProjectRest({ projects: { create } });

      const response = await send("/api/projects", {
        method: "POST",
        body: { name: "No Team", language: "python", framework: "langchain" },
      });

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    });

    it("reads a team outside the organization as a bad request", async () => {
      const { send } = mountProjectRest({
        projects: {
          create: vi.fn(async (): Promise<Project> => {
            throw new TeamNotInOrganizationError("Team does not belong to this organization");
          }),
        },
      });

      const response = await send("/api/projects", {
        method: "POST",
        body: {
          name: "Wrong Team",
          teamId: "nonexistent-team-id",
          language: "python",
          framework: "langchain",
        },
      });

      expect(response.status).toBe(400);
    });

    it("refuses a personal-workspace boundary and reports a slug clash", async () => {
      const boundary = mountProjectRest({
        projects: {
          create: vi.fn(async (): Promise<Project> => {
            throw new PersonalWorkspaceBoundaryError("Not managed here");
          }),
        },
      });
      const clash = mountProjectRest({
        projects: {
          create: vi.fn(async (): Promise<Project> => {
            throw new ProjectSlugConflictError("Slug already taken");
          }),
        },
      });
      const body = {
        name: "Clashing",
        teamId: "team-1",
        language: "python",
        framework: "langchain",
      };

      expect((await boundary.send("/api/projects", { method: "POST", body })).status).toBe(403);

      const conflict = await clash.send("/api/projects", { method: "POST", body });
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({ error: "Conflict" });
    });

    it("refuses a caller without project:create", async () => {
      const create = vi.fn(async () => project());
      const { send } = mountProjectRest({ projects: { create }, granted: ["project:view"] });

      const response = await send("/api/projects", {
        method: "POST",
        body: {
          name: "Nope",
          teamId: "team-1",
          language: "python",
          framework: "langchain",
        },
      });

      expect(response.status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when the collection is listed", () => {
    /** @scenario Listing projects never discloses base keys */
    it("answers with the page and never discloses a base key", async () => {
      const listByOrganization = vi.fn(async () => page([project(), project({ id: "project_2" })]));
      const { send } = mountProjectRest({
        projects: { listByOrganization },
        apiKeys: { resolveVisibleProjects: vi.fn(async () => SEES_EVERYTHING) },
      });

      const response = await send("/api/projects");

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>;
        pagination: { page: number; limit: number; total: number };
      };
      expect(body.pagination).toEqual({ page: 1, limit: 50, total: 2 });
      for (const row of body.data) {
        expect(row).not.toHaveProperty("apiKey");
        expect(row).not.toHaveProperty("lwqlKey");
      }
      expect(JSON.stringify(body)).not.toContain(project().apiKey);
    });

    it("passes the requested page and limit through", async () => {
      const listByOrganization = vi.fn(async () => page([], 0));
      const { send } = mountProjectRest({
        projects: { listByOrganization },
        apiKeys: { resolveVisibleProjects: vi.fn(async () => SEES_EVERYTHING) },
      });

      await send("/api/projects?page=2&limit=2");

      expect(listByOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, page: 2, limit: 2 }),
      );
    });

    /**
     * The listing is `anyAuthenticated`, not a `project:view` demand: a
     * credential whose reach is narrower than the organization gets exactly
     * the projects it can see, with a 200.
     */
    describe("given a credential bound to some of the organization's projects", () => {
      /** @scenario "project-scoped key gets a filtered list, not a refusal" */
      it("narrows the query to those projects and answers 200", async () => {
        const listByOrganization = vi.fn(async () => page([project()], 1));
        const resolveVisibleProjects = vi.fn(
          async (): Promise<ApiKeyVisibleProjects> => ({
            kind: "some",
            ids: ["project_1", "project_9"],
          }),
        );
        const { send } = mountProjectRest({
          projects: { listByOrganization },
          apiKeys: { resolveVisibleProjects },
        });

        const response = await send("/api/projects?limit=100");

        expect(response.status).toBe(200);
        expect(resolveVisibleProjects).toHaveBeenCalledWith({
          apiKeyId: API_KEY_ID,
          organizationId: ORGANIZATION_ID,
        });
        expect(listByOrganization).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          page: 1,
          limit: 100,
          projectIds: ["project_1", "project_9"],
        });
      });

      /** @scenario "a key without project:view gets an empty list, not a refusal" */
      it("answers 200 with an empty list when the credential reaches nothing", async () => {
        const listByOrganization = vi.fn(async () => page([], 0));
        const { send } = mountProjectRest({
          projects: { listByOrganization },
          apiKeys: {
            resolveVisibleProjects: vi.fn(
              async (): Promise<ApiKeyVisibleProjects> => ({ kind: "some", ids: [] }),
            ),
          },
          granted: [],
        });

        const response = await send("/api/projects");

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          data: [],
          pagination: { page: 1, limit: 50, total: 0 },
        });
      });
    });

    /** @scenario "org-scoped key lists every project in the organization" */
    it("leaves the query unfiltered for a credential that reaches the organization", async () => {
      const listByOrganization = vi.fn(async () => page([project()]));
      const { send } = mountProjectRest({
        projects: { listByOrganization },
        apiKeys: { resolveVisibleProjects: vi.fn(async () => SEES_EVERYTHING) },
      });

      await send("/api/projects");

      expect(listByOrganization).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        page: 1,
        limit: 50,
      });
    });
  });

  describe("when one project is read", () => {
    /** @scenario Reading a project never discloses its base key */
    it("answers without the base key or the service key", async () => {
      const { send } = mountProjectRest({
        projects: { tryGetWithTeam: vi.fn(async () => projectWithTeam()) },
      });

      const response = await send("/api/projects/project_1");

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.id).toBe("project_1");
      expect(body).not.toHaveProperty("apiKey");
      expect(body).not.toHaveProperty("serviceApiKey");
      expect(JSON.stringify(body)).not.toContain(project().apiKey);
    });

    it("reports an unknown id as not found", async () => {
      const { send } = mountProjectRest({
        projects: { tryGetWithTeam: vi.fn(async () => null) },
      });

      expect((await send("/api/projects/project_doesnotexist")).status).toBe(404);
    });

    it("reports a project in another organization as not found", async () => {
      const { send } = mountProjectRest({
        projects: {
          tryGetWithTeam: vi.fn(async () =>
            projectWithTeam({
              team: { ...projectWithTeam().team, organizationId: "organization-other" },
            }),
          ),
        },
      });

      expect((await send("/api/projects/project_1")).status).toBe(404);
    });
  });

  describe("when a project is updated", () => {
    /** @scenario PATCH /api/projects/:id updates project name */
    it("sends exactly the fields the body carried and answers with the result", async () => {
      const update = vi.fn(async () =>
        project({ name: "Updated Project Name", language: "typescript" }),
      );
      const { send } = mountProjectRest({ projects: { update } });

      const response = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { name: "Updated Project Name", language: "typescript" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        name: "Updated Project Name",
        language: "typescript",
        framework: "langchain",
      });
      expect(update).toHaveBeenCalledWith({
        id: "project_1",
        organizationId: ORGANIZATION_ID,
        data: { name: "Updated Project Name", language: "typescript" },
      });
    });

    /** @scenario PATCH /api/projects/:id moves project to different team */
    it("moves the project when the body names a destination team", async () => {
      const update = vi.fn(async () => project({ teamId: "team-destination" }));
      const { send } = mountProjectRest({ projects: { update } });

      const response = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { teamId: "team-destination" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ teamId: "team-destination" });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { teamId: "team-destination" } }),
      );
    });

    /** @scenario PATCH /api/projects/:id updates name and team together */
    it("sends a rename and a move as one write", async () => {
      const update = vi.fn(async () =>
        project({ name: "Moved And Renamed", teamId: "team-destination" }),
      );
      const { send } = mountProjectRest({ projects: { update } });

      await send("/api/projects/project_1", {
        method: "PATCH",
        body: { name: "Moved And Renamed", teamId: "team-destination" },
      });

      expect(update).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: "Moved And Renamed", teamId: "team-destination" },
        }),
      );
    });

    /**
     * @scenario PATCH rejects non-existent teamId
     * @scenario PATCH rejects teamId of archived team
     * @scenario PATCH rejects teamId from different organization
     *
     * All three are one refusal at this boundary: the service decides which
     * destination teams are reachable and says so with one error, and the door
     * turns that into 400. Which destinations qualify is the service's test.
     */
    it("reads an unreachable destination team as a bad request", async () => {
      const { send } = mountProjectRest({
        projects: {
          update: vi.fn(async (): Promise<Project> => {
            throw new DestinationTeamNotFoundError("Destination team not found");
          }),
        },
      });

      const response = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { teamId: "nonexistent-team" },
      });

      expect(response.status).toBe(400);
    });

    /**
     * @scenario PATCH with teamId and name is atomic
     *
     * The door's half of atomicity is that the rename and the move travel in
     * ONE `update` call, so a rejected destination cannot leave a persisted
     * rename behind. Whether that call is transactional is the repository's.
     */
    it("does not write the name separately when the move is refused", async () => {
      const update = vi.fn(async (): Promise<Project> => {
        throw new DestinationTeamNotFoundError("Destination team not found");
      });
      const { send } = mountProjectRest({ projects: { update } });

      const response = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { name: "Should Not Persist", teamId: "nonexistent-team" },
      });

      expect(response.status).toBe(400);
      expect(update).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: "Should Not Persist", teamId: "nonexistent-team" },
        }),
      );
    });

    it("reports an unknown project as not found", async () => {
      const { send } = mountProjectRest({
        projects: {
          update: vi.fn(async (): Promise<Project> => {
            throw new ProjectNotFoundError();
          }),
        },
      });

      const response = await send("/api/projects/project_ghost", {
        method: "PATCH",
        body: { name: "Whatever" },
      });

      expect(response.status).toBe(404);
    });

    it("reads a personal-workspace boundary as a refusal", async () => {
      const { send } = mountProjectRest({
        projects: {
          update: vi.fn(async (): Promise<Project> => {
            throw new PersonalWorkspaceBoundaryError("Not managed here");
          }),
        },
      });

      const response = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { name: "Whatever" },
      });

      expect(response.status).toBe(403);
    });
  });

  describe("when a project is archived", () => {
    it("answers with the archived project's id and timestamp", async () => {
      const archivedAt = new Date("2026-08-25T00:00:00.000Z");
      const archive = vi.fn(async () => project({ archivedAt }));
      const { send } = mountProjectRest({ projects: { archive } });

      const response = await send("/api/projects/project_1", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "project_1",
        name: "My Test Project",
        archivedAt: archivedAt.toISOString(),
      });
      expect(archive).toHaveBeenCalledWith({ id: "project_1", organizationId: ORGANIZATION_ID });
    });

    it("reports an unknown project as not found", async () => {
      const { send } = mountProjectRest({
        projects: {
          archive: vi.fn(async (): Promise<Project> => {
            throw new ProjectNotFoundError();
          }),
        },
      });

      expect((await send("/api/projects/project_nope", { method: "DELETE" })).status).toBe(404);
    });

    it("refuses to archive a personal project", async () => {
      const { send } = mountProjectRest({
        projects: {
          archive: vi.fn(async (): Promise<Project> => {
            throw new PersonalProjectProtectedError("Personal projects cannot be archived");
          }),
        },
      });

      expect((await send("/api/projects/project_1", { method: "DELETE" })).status).toBe(403);
    });
  });

  describe("given the base key, which is a project-level write credential", () => {
    /** @scenario A caller who can change the project reads the base key */
    it("hands the base key to a caller who can update that project", async () => {
      const { send } = mountProjectRest({
        projects: { tryGetWithTeam: vi.fn(async () => projectWithTeam()) },
        grantedOnProject: { project_1: ["project:update"] },
      });

      const response = await send("/api/projects/project_1/api-key");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ apiKey: project().apiKey });
    });

    /** @scenario A read-only credential cannot read the base key */
    it("refuses a caller who can only view the project, and discloses nothing", async () => {
      const tryGetWithTeam = vi.fn(async () => projectWithTeam());
      const { send } = mountProjectRest({
        projects: { tryGetWithTeam },
        grantedOnProject: { project_1: ["project:view"] },
      });

      const response = await send("/api/projects/project_1/api-key");

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(project().apiKey);
      expect(tryGetWithTeam).not.toHaveBeenCalled();
    });

    /** @scenario Permission is checked against the requested project */
    it("refuses a project-scoped caller asking about a sibling project", async () => {
      const { send } = mountProjectRest({
        projects: { tryGetWithTeam: vi.fn(async () => projectWithTeam()) },
        grantedOnProject: { project_1: ["project:update"], project_2: [] },
      });

      expect((await send("/api/projects/project_1/api-key")).status).toBe(200);

      const sibling = await send("/api/projects/project_2/api-key");
      expect(sibling.status).toBe(403);
      expect(await sibling.text()).not.toContain(project().apiKey);
    });

    /** @scenario A project in another organization is not disclosed */
    it("reports a project in another organization as not found", async () => {
      const foreign = projectWithTeam({
        team: { ...projectWithTeam().team, organizationId: "organization-other" },
      });
      const { send } = mountProjectRest({
        projects: { tryGetWithTeam: vi.fn(async () => foreign) },
        grantedOnProject: { project_1: ["project:update"] },
      });

      const response = await send("/api/projects/project_1/api-key");

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(foreign.apiKey);
    });
  });

  describe("when the base key is rotated", () => {
    it("answers with the new key", async () => {
      const regenerateLegacyProjectKey = vi.fn(async () => "sk-lw-rotated");
      const { send } = mountProjectRest({
        projects: { tryGetWithTeam: vi.fn(async () => projectWithTeam()) },
        apiKeys: { regenerateLegacyProjectKey },
      });

      const response = await send("/api/projects/project_1/regenerate-api-key", {
        method: "POST",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ apiKey: "sk-lw-rotated" });
      expect(regenerateLegacyProjectKey).toHaveBeenCalledWith({ projectId: "project_1" });
    });

    it("reports a project in another organization as not found, rotating nothing", async () => {
      const regenerateLegacyProjectKey = vi.fn(async () => "sk-lw-rotated");
      const { send } = mountProjectRest({
        projects: {
          tryGetWithTeam: vi.fn(async () =>
            projectWithTeam({
              team: { ...projectWithTeam().team, organizationId: "organization-other" },
            }),
          ),
        },
        apiKeys: { regenerateLegacyProjectKey },
      });

      const response = await send("/api/projects/project_1/regenerate-api-key", {
        method: "POST",
      });

      expect(response.status).toBe(404);
      expect(regenerateLegacyProjectKey).not.toHaveBeenCalled();
    });
  });

  /**
   * Finding H4 of the 2026-09-04 feature-surface security pass.
   * Spec: specs/security/resource-scope-permission-checks.feature
   */
  describe("given a credential whose grant covers one project and not its sibling", () => {
    // Organization-wide grants stay held, so a check resolved at the
    // organization would pass every route below: what refuses the sibling is
    // the project scope, and nothing else.
    const SCOPED = {
      granted: ["project:view", "project:update", "project:delete", "project:manage"],
      grantedOnProject: {
        project_1: ["project:view", "project:update", "project:delete", "project:manage"],
        project_2: [],
      },
    };

    /** @scenario A project route resolves its permission at the project it names */
    it("refuses to read a sibling project, and never reaches the service", async () => {
      const tryGetWithTeam = vi.fn(async () => projectWithTeam());
      const { send } = mountProjectRest({ ...SCOPED, projects: { tryGetWithTeam } });

      expect((await send("/api/projects/project_2")).status).toBe(403);
      expect(tryGetWithTeam).not.toHaveBeenCalled();
    });

    it("refuses to update or archive a sibling project", async () => {
      const update = vi.fn(async () => project());
      const archive = vi.fn(async () => project());
      const { send } = mountProjectRest({ ...SCOPED, projects: { update, archive } });

      expect(
        (await send("/api/projects/project_2", { method: "PATCH", body: { name: "Renamed" } }))
          .status,
      ).toBe(403);
      expect((await send("/api/projects/project_2", { method: "DELETE" })).status).toBe(403);
      expect(update).not.toHaveBeenCalled();
      expect(archive).not.toHaveBeenCalled();
    });

    /** @scenario Rotating a project's ingestion key is authorized on that project */
    it("refuses to rotate a sibling project's ingestion key, and rotates nothing", async () => {
      const regenerateLegacyProjectKey = vi.fn(async () => "sk-lw-rotated");
      const { send } = mountProjectRest({
        ...SCOPED,
        projects: { tryGetWithTeam: vi.fn(async () => projectWithTeam()) },
        apiKeys: { regenerateLegacyProjectKey },
      });

      const response = await send("/api/projects/project_2/regenerate-api-key", {
        method: "POST",
      });

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("sk-lw-rotated");
      expect(regenerateLegacyProjectKey).not.toHaveBeenCalled();
    });

    it("still serves the project the grant does name", async () => {
      const { send } = mountProjectRest({
        ...SCOPED,
        projects: { tryGetWithTeam: vi.fn(async () => projectWithTeam()) },
      });

      expect((await send("/api/projects/project_1")).status).toBe(200);
    });
  });
});
