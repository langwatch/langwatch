/**
 * @vitest-environment node
 * The `/api/projects` REST door: input validation, route access, the status
 * a domain refusal becomes, and the wire body — not what the domain decides.
 * Spec: specs/projects/projects-management-door.feature
 */
import type { ApiKeyVisibleProjects } from "@langwatch/api-key-contract";
import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type PaginatedProjects,
  type ArchivedProject,
  type Project,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { API_KEY_ID, mountProjectRest, ORGANIZATION_ID, USER_ID } from "./project.rest.harness.ts";

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
function mintedServiceKey(): { token: string; apiKeyId: string } {
  return { token: "sk-lw-service-token", apiKeyId: "api-key-service" };
}

/** The visibility answer a credential whose reach is the whole organization gets. */
const SEES_EVERYTHING: ApiKeyVisibleProjects = { kind: "all" };

/** Every listing route resolves the credential's reach before it queries. */
const REACHES_EVERYTHING = { resolveVisibleProjects: vi.fn(async () => SEES_EVERYTHING) };

describe("the projects REST family", () => {
  describe("given no credential", () => {
    it("refuses before the request reaches the application", async () => {
      const listByOrganization = vi.fn(async () => page([]));
      const { hono } = mountProjectRest({ app: { listByOrganization } });

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
      const createInOrganization = vi.fn(async () => project());
      const provisionServiceKey = vi.fn(async () => mintedServiceKey());
      const { send } = mountProjectRest({ app: { createInOrganization, provisionServiceKey } });

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
      expect(createInOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, userId: USER_ID }),
      );
      expect(provisionServiceKey).toHaveBeenCalledWith({
        projectId: "project_1",
        projectName: "My Test Project",
        organizationId: ORGANIZATION_ID,
        createdByUserId: USER_ID,
      });
    });

    it("provisions into a new team when the request names one instead of an id", async () => {
      const createInOrganization = vi.fn(async () => project({ teamId: "team-new" }));
      const { send } = mountProjectRest({
        app: { createInOrganization, provisionServiceKey: vi.fn(async () => mintedServiceKey()) },
      });

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
      expect(createInOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ newTeamName: "API Team", teamId: undefined }),
      );
    });

    it("refuses a body with no name", async () => {
      const createInOrganization = vi.fn(async () => project());
      const { send } = mountProjectRest({ app: { createInOrganization } });

      const response = await send("/api/projects", {
        method: "POST",
        body: { teamId: "team-1", language: "python", framework: "langchain" },
      });

      expect(response.status).toBe(422);
      expect(createInOrganization).not.toHaveBeenCalled();
    });

    it("refuses a body that names neither an existing team nor a new one", async () => {
      const createInOrganization = vi.fn(async () => project());
      const { send } = mountProjectRest({ app: { createInOrganization } });

      const response = await send("/api/projects", {
        method: "POST",
        body: { name: "No Team", language: "python", framework: "langchain" },
      });

      expect(response.status).toBe(422);
      expect(createInOrganization).not.toHaveBeenCalled();
    });

    it("reads a team outside the organization as a bad request", async () => {
      const { send } = mountProjectRest({
        app: {
          createInOrganization: vi.fn(async (): Promise<Project> => {
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
        app: {
          createInOrganization: vi.fn(async (): Promise<Project> => {
            throw new PersonalWorkspaceBoundaryError("Not managed here");
          }),
        },
      });
      const clash = mountProjectRest({
        app: {
          createInOrganization: vi.fn(async (): Promise<Project> => {
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
      const createInOrganization = vi.fn(async () => project());
      const { send } = mountProjectRest({
        app: { createInOrganization },
        granted: ["project:view"],
      });

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
      expect(createInOrganization).not.toHaveBeenCalled();
    });
  });

  describe("when the collection is listed", () => {
    /** @scenario Listing projects never discloses base keys */
    it("answers with the page and never discloses a base key", async () => {
      const listByOrganization = vi.fn(async () => page([project(), project({ id: "project_2" })]));
      const { send } = mountProjectRest({
        app: { listByOrganization, ...REACHES_EVERYTHING },
      });

      const response = await send("/api/projects");

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: Record<string, unknown>[];
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
        app: { listByOrganization, ...REACHES_EVERYTHING },
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
        const resolveVisibleProjects = vi.fn(async (): Promise<ApiKeyVisibleProjects> => ({
          kind: "some",
          ids: ["project_1", "project_9"],
        }));
        const { send } = mountProjectRest({
          app: { listByOrganization, resolveVisibleProjects },
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
          app: {
            listByOrganization,
            resolveVisibleProjects: vi.fn(async (): Promise<ApiKeyVisibleProjects> => ({
              kind: "some",
              ids: [],
            })),
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
        app: { listByOrganization, ...REACHES_EVERYTHING },
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
        app: { findWithTeam: vi.fn(async () => projectWithTeam()) },
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
        app: { findWithTeam: vi.fn(async () => null) },
      });

      expect((await send("/api/projects/project_doesnotexist")).status).toBe(404);
    });

    /** @scenario A project in another organization is not disclosed */
    it("reports a project in another organization as not found, disclosing nothing", async () => {
      const foreign = projectWithTeam({
        team: { ...projectWithTeam().team, organizationId: "organization-other" },
      });
      const { send } = mountProjectRest({
        app: { findWithTeam: vi.fn(async () => foreign) },
      });

      const response = await send("/api/projects/project_1");

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(foreign.apiKey);
    });
  });

  describe("when a project is updated", () => {
    /** @scenario PATCH /api/projects/:id updates project name */
    it("sends exactly the fields the body carried and answers with the result", async () => {
      const updateInOrganization = vi.fn(async () =>
        project({ name: "Updated Project Name", language: "typescript" }),
      );
      const { send } = mountProjectRest({ app: { updateInOrganization } });

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
      expect(updateInOrganization).toHaveBeenCalledWith({
        projectId: "project_1",
        organizationId: ORGANIZATION_ID,
        data: { name: "Updated Project Name", language: "typescript" },
      });
    });

    /**
     * @scenario "the management door writes at the organization the credential resolved"
     *
     * The organization is the CREDENTIAL's, never the project's own. It is the
     * one argument that keeps a token issued for one organization from writing
     * to another's project, and the operation the door calls is named for it.
     */
    it("scopes the write to the credential's organization and nothing else", async () => {
      const updateInOrganization = vi.fn(async () => project());
      const { send } = mountProjectRest({ app: { updateInOrganization } });

      await send("/api/projects/project_1", { method: "PATCH", body: { name: "Renamed" } });

      expect(updateInOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID }),
      );
    });

    /** @scenario PATCH /api/projects/:id moves project to different team */
    it("moves the project when the body names a destination team", async () => {
      const updateInOrganization = vi.fn(async () => project({ teamId: "team-destination" }));
      const { send } = mountProjectRest({ app: { updateInOrganization } });

      const response = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { teamId: "team-destination" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ teamId: "team-destination" });
      expect(updateInOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ data: { teamId: "team-destination" } }),
      );
    });

    /** @scenario PATCH /api/projects/:id updates name and team together */
    it("sends a rename and a move as one write", async () => {
      const updateInOrganization = vi.fn(async () =>
        project({ name: "Moved And Renamed", teamId: "team-destination" }),
      );
      const { send } = mountProjectRest({ app: { updateInOrganization } });

      await send("/api/projects/project_1", {
        method: "PATCH",
        body: { name: "Moved And Renamed", teamId: "team-destination" },
      });

      expect(updateInOrganization).toHaveBeenCalledOnce();
      expect(updateInOrganization).toHaveBeenCalledWith(
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
     * All three are one refusal at this boundary: the application decides which
     * destination teams are reachable and says so with one error, and the door
     * turns that into 400. Which destinations qualify is the service's test.
     */
    it("reads an unreachable destination team as a bad request", async () => {
      const { send } = mountProjectRest({
        app: {
          updateInOrganization: vi.fn(async (): Promise<Project> => {
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
     * ONE update call, so a rejected destination cannot leave a persisted
     * rename behind. Whether that call is transactional is the repository's.
     */
    it("does not write the name separately when the move is refused", async () => {
      const updateInOrganization = vi.fn(async (): Promise<Project> => {
        throw new DestinationTeamNotFoundError("Destination team not found");
      });
      const { send } = mountProjectRest({ app: { updateInOrganization } });

      const response = await send("/api/projects/project_1", {
        method: "PATCH",
        body: { name: "Should Not Persist", teamId: "nonexistent-team" },
      });

      expect(response.status).toBe(400);
      expect(updateInOrganization).toHaveBeenCalledOnce();
      expect(updateInOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: "Should Not Persist", teamId: "nonexistent-team" },
        }),
      );
    });

    it("reports an unknown project as not found", async () => {
      const { send } = mountProjectRest({
        app: {
          updateInOrganization: vi.fn(async (): Promise<Project> => {
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
        app: {
          updateInOrganization: vi.fn(async (): Promise<Project> => {
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
    it("answers with the archived project's id, name and timestamp", async () => {
      const archivedAt = new Date("2026-08-25T00:00:00.000Z");
      const archiveInOrganization = vi.fn(async () => ({ ...project(), archivedAt }));
      const { send } = mountProjectRest({ app: { archiveInOrganization } });

      const response = await send("/api/projects/project_1", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "project_1",
        name: "My Test Project",
        archivedAt: archivedAt.toISOString(),
      });
      expect(archiveInOrganization).toHaveBeenCalledWith({
        projectId: "project_1",
        organizationId: ORGANIZATION_ID,
      });
    });

    it("reports an unknown project as not found", async () => {
      const { send } = mountProjectRest({
        app: {
          archiveInOrganization: vi.fn(async (): Promise<ArchivedProject> => {
            throw new ProjectNotFoundError();
          }),
        },
      });

      expect((await send("/api/projects/project_nope", { method: "DELETE" })).status).toBe(404);
    });

    it("refuses to archive a personal project", async () => {
      const { send } = mountProjectRest({
        app: {
          archiveInOrganization: vi.fn(async (): Promise<ArchivedProject> => {
            throw new PersonalProjectProtectedError("Personal projects cannot be archived");
          }),
        },
      });

      expect((await send("/api/projects/project_1", { method: "DELETE" })).status).toBe(403);
    });
  });

  /**
   * `/api/projects` reached with an ORGANIZATION API token: the base key
   * authenticates every ingestion call, so both routes are withdrawn
   * outright (`refuseBaseKeyToApiToken`) — {@link ProjectManagementApi} carries none.
   */
  describe("given a caller holding an organization API token", () => {
    /** @scenario "An API key principal cannot read the base key" */
    it("refuses the base key however much the token holds on that project", async () => {
      const findWithTeam = vi.fn(async () => projectWithTeam());
      const { send } = mountProjectRest({
        app: { findWithTeam },
        grantedOnProject: { project_1: ["project:view", "project:update", "project:manage"] },
      });

      const response = await send("/api/projects/project_1/api-key");

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(project().apiKey);
    });

    /** @scenario "API key refusal happens before the project is read" */
    it("refuses an unknown project id the same way, without looking it up", async () => {
      const findWithTeam = vi.fn(async () => null);
      const { send } = mountProjectRest({
        app: { findWithTeam },
        grantedOnProject: { project_doesnotexist: ["project:manage"] },
      });

      const response = await send("/api/projects/project_doesnotexist/api-key");

      // 403 and not 404: a 404 here would answer "does this project exist?"
      // for any token that can reach the door.
      expect(response.status).toBe(403);
      expect(findWithTeam).not.toHaveBeenCalled();
    });

    it("names the one way the key can still be read", async () => {
      const { send } = mountProjectRest({
        app: { findWithTeam: vi.fn(async () => projectWithTeam()) },
        grantedOnProject: { project_1: ["project:manage"] },
      });

      expect(await (await send("/api/projects/project_1/api-key")).text()).toContain(
        "signed-in project administrator",
      );
    });
  });

  describe("when an organization API token asks for the base key to be rotated", () => {
    it("refuses, and hands back nothing that could authenticate", async () => {
      const { send } = mountProjectRest({
        app: { findWithTeam: vi.fn(async () => projectWithTeam()) },
        grantedOnProject: { project_1: ["project:manage"] },
      });

      const response = await send("/api/projects/project_1/regenerate-api-key", {
        method: "POST",
      });

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("sk-lw");
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
    it("refuses to read a sibling project, and never reaches the application", async () => {
      const findWithTeam = vi.fn(async () => projectWithTeam());
      const { send } = mountProjectRest({ ...SCOPED, app: { findWithTeam } });

      expect((await send("/api/projects/project_2")).status).toBe(403);
      expect(findWithTeam).not.toHaveBeenCalled();
    });

    it("refuses to update or archive a sibling project", async () => {
      const updateInOrganization = vi.fn(async () => project());
      const archiveInOrganization = vi.fn(async () => ({ ...project(), archivedAt: new Date(0) }));
      const { send } = mountProjectRest({
        ...SCOPED,
        app: { updateInOrganization, archiveInOrganization },
      });

      expect(
        (await send("/api/projects/project_2", { method: "PATCH", body: { name: "Renamed" } }))
          .status,
      ).toBe(403);
      expect((await send("/api/projects/project_2", { method: "DELETE" })).status).toBe(403);
      expect(updateInOrganization).not.toHaveBeenCalled();
      expect(archiveInOrganization).not.toHaveBeenCalled();
    });

    /**
     * Still refused, and now for a stronger reason than scope: this door
     * refuses base-key rotation to EVERY organization token, sibling or not.
     * The scenario asks only that a sibling's key is not rotated, so it is
     * satisfied either way.
     */
    /** @scenario Rotating a project's ingestion key is authorized on that project */
    it("refuses to rotate a sibling project's ingestion key, and rotates nothing", async () => {
      const { send } = mountProjectRest({
        ...SCOPED,
        app: { findWithTeam: vi.fn(async () => projectWithTeam()) },
      });

      const response = await send("/api/projects/project_2/regenerate-api-key", {
        method: "POST",
      });

      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("sk-lw");
    });

    it("still serves the project the grant does name", async () => {
      const { send } = mountProjectRest({
        ...SCOPED,
        app: { findWithTeam: vi.fn(async () => projectWithTeam()) },
      });

      expect((await send("/api/projects/project_1")).status).toBe(200);
    });
  });
});
