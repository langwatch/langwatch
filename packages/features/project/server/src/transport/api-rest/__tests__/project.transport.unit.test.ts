/**
 * The `/api/projects` REST door: input validation, the access policy each
 * route declares, the status a domain refusal becomes, and the wire body.
 *
 * Ported from
 * `platform/app/src/app/api/projects/__tests__/projects-rest-api.integration.test.ts`
 * and `projects-filtered-listing.integration.test.ts`, both of which drove
 * this family against real Postgres with real role bindings. What they proved
 * about the DOOR is here. What they proved about the domain — that a
 * destination team in another organization is rejected, that a demoted owner's
 * key sees fewer projects — belongs to the service and to the API-key
 * visibility resolver, so what is asserted here is that the door asks them and
 * renders the answer.
 *
 * The two `@scenario` annotations on the base-key routes are carried across
 * verbatim: they bind spec scenarios, and dropping one silently unbinds it.
 *
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 *       specs/api-keys/project-key-read-access.feature
 */
import type { ApiKey, ApiKeyService, ApiKeyVisibleProjects } from "@langwatch/api-key-contract";
import {
  createRestApiService,
  getRoutePolicy,
  type AppRestOrganizationVariables,
  type AppRestProjectVariables,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type PaginatedProjects,
  type Project,
  type ProjectService,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import type { MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";
import { createProjectRestApp } from "../project.api";
import { TestApiKeyService } from "./support/test-api-key-service";
import { TestProjectService } from "./support/test-project-service";

const ORGANIZATION_ID = "organization-1";
const USER_ID = "user-1";
const API_KEY_ID = "api-key-1";
const CREDENTIAL = "organization-credential";

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

/**
 * A handled error as this boundary can recognise one without depending on the
 * package that defines it: a stable `code` and its own status. That is the
 * same duck-type the application's own handler falls back to for a payload
 * that has already crossed a serialisation boundary.
 */
type HandledShape = { code?: unknown; httpStatus?: unknown; message: string };

function handledFieldsOf(error: Error): { code: string; status: ContentfulStatusCode } | null {
  const candidate: HandledShape = error;
  return typeof candidate.code === "string" && typeof candidate.httpStatus === "number"
    ? { code: candidate.code, status: candidate.httpStatus as ContentfulStatusCode }
    : null;
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

/**
 * The enforcement the process owns and this package does not.
 *
 * `granted` is the set of permissions the presented credential holds at the
 * organization; `grantedOnProject` is what it holds at the project a route
 * names. They are separate because the base-key route is authorized at the
 * project's scope rather than the organization's, and a test that conflated
 * them could not tell an org-wide grant from a per-project one — which is the
 * whole subject of that route's policy.
 */
function spine(options: {
  granted?: readonly string[];
  grantedOnProject?: Readonly<Record<string, readonly string[]>>;
} = {}) {
  const granted = new Set(
    options.granted ?? [
      "project:create",
      "project:view",
      "project:update",
      "project:delete",
      "project:manage",
    ],
  );
  const grantedOnProject = options.grantedOnProject;

  const authenticateOrganization: MiddlewareHandler = async (c, next) => {
    if (c.req.header("Authorization") !== `Bearer ${CREDENTIAL}`) {
      return c.json({ error: "Unauthorized", message: "Invalid credential" }, 401);
    }
    c.set("organization", { id: ORGANIZATION_ID });
    c.set("apiKeyId", API_KEY_ID);
    c.set("apiKeyUserId", USER_ID);
    c.set("apiKeyOrganizationId", ORGANIZATION_ID);
    c.set("orgResolvedToken", {
      type: "apiKey-org",
      apiKeyId: API_KEY_ID,
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    });
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: (error, c) => {
      const handled = handledFieldsOf(error);
      if (handled) {
        return c.json({ error: handled.code, message: error.message }, handled.status);
      }
      return c.json({ error: "Internal server error" }, 500);
    },
    canonicalErrorHandler: (error, c) => c.json({ error: { message: error.message } }, 500),
    authenticateProject: () => async (_c, next) => next(),
    authorizeProjectPermission: () => async (_c, next) => next(),
    authorizeApiKeyCeiling: () => async (_c, next) => next(),
    authenticateOrganization: () => authenticateOrganization,
    authorizeOrganizationPermission:
      ({ permission }) =>
      async (c, next) => {
        if (!granted.has(permission)) {
          return c.json({ error: "Forbidden", message: "Missing permission" }, 403);
        }
        await next();
      },
    authorizeRouteProjectPermission:
      ({ permission, param }) =>
      async (c, next) => {
        const projectId = c.req.param(param) ?? "";
        const held = grantedOnProject?.[projectId] ?? [...granted];
        if (!held.includes(permission)) {
          return c.json({ error: "Forbidden", message: "Missing permission" }, 403);
        }
        await next();
      },
    authenticateOrganizationThrowing: async (_c, next) => next(),
    authorizeOrganizationPermissionThrowing: () => async (_c, next) => next(),
  };

  return createRestApiService<AppRestProjectVariables, AppRestOrganizationVariables>(ports);
}

function buildApi(
  options: {
    projects?: Partial<TestProjectService>;
    apiKeys?: Partial<TestApiKeyService>;
    granted?: readonly string[];
    grantedOnProject?: Readonly<Record<string, readonly string[]>>;
  } = {},
) {
  const projects: ProjectService = Object.assign(new TestProjectService(), options.projects);
  const apiKeys: ApiKeyService = Object.assign(new TestApiKeyService(), options.apiKeys);

  const { hono } = createProjectRestApp({
    security: spine({
      ...(options.granted ? { granted: options.granted } : {}),
      ...(options.grantedOnProject ? { grantedOnProject: options.grantedOnProject } : {}),
    }),
    projects: () => projects,
    apiKeys: () => apiKeys,
  });

  const send = (
    path: string,
    init: { method?: string; body?: unknown; credential?: string } = {},
  ) =>
    hono.request(path, {
      ...(init.method === undefined ? {} : { method: init.method }),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: {
        Authorization: `Bearer ${init.credential ?? CREDENTIAL}`,
        "Content-Type": "application/json",
      },
    });

  return { hono, send };
}

/** The visibility answer a credential whose reach is the whole organization gets. */
const SEES_EVERYTHING: ApiKeyVisibleProjects = { kind: "all" };

describe("createProjectRestApp", () => {
  describe("given no credential", () => {
    it("refuses before the request reaches the service", async () => {
      const listByOrganization = vi.fn(async () => page([]));
      const { hono } = buildApi({ projects: { listByOrganization } });

      const response = await hono.request("/api/projects");

      expect(response.status).toBe(401);
      expect(listByOrganization).not.toHaveBeenCalled();
    });

    it("refuses a credential it does not recognise", async () => {
      const { send } = buildApi();

      const response = await send("/api/projects", { credential: "sk-lw-invalid_token" });

      expect(response.status).toBe(401);
    });
  });

  describe("when a project is provisioned", () => {
    it("returns the project with a freshly minted service key and no base key", async () => {
      const create = vi.fn(async () => project());
      const mint = vi.fn(async () => mintedServiceKey());
      const { send } = buildApi({ projects: { create }, apiKeys: { create: mint } });

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
      const { send } = buildApi({ projects: { create }, apiKeys: { create: mint } });

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
      const { send } = buildApi({ projects: { create } });

      const response = await send("/api/projects", {
        method: "POST",
        body: { teamId: "team-1", language: "python", framework: "langchain" },
      });

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    });

    it("refuses a body that names neither an existing team nor a new one", async () => {
      const create = vi.fn(async () => project());
      const { send } = buildApi({ projects: { create } });

      const response = await send("/api/projects", {
        method: "POST",
        body: { name: "No Team", language: "python", framework: "langchain" },
      });

      expect(response.status).toBe(422);
      expect(create).not.toHaveBeenCalled();
    });

    it("reads a team outside the organization as a bad request", async () => {
      const { send } = buildApi({
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
      const boundary = buildApi({
        projects: {
          create: vi.fn(async (): Promise<Project> => {
            throw new PersonalWorkspaceBoundaryError("Not managed here");
          }),
        },
      });
      const clash = buildApi({
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
      const { send } = buildApi({ projects: { create }, granted: ["project:view"] });

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
    it("answers with the page and never discloses a base key", async () => {
      /** @scenario Listing projects never discloses base keys */
      const listByOrganization = vi.fn(async () => page([project(), project({ id: "project_2" })]));
      const { send } = buildApi({
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
      const { send } = buildApi({
        projects: { listByOrganization },
        apiKeys: { resolveVisibleProjects: vi.fn(async () => SEES_EVERYTHING) },
      });

      await send("/api/projects?page=2&limit=2");

      expect(listByOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, page: 2, limit: 2 }),
      );
    });

    /**
     * The listing is `anyAuthenticated`, not `requires("project:view")`: a
     * credential whose reach is narrower than the organization gets exactly
     * the projects it can see, with a 200. A 403 here would be the difference
     * between "you may not ask" and "here is what you may see", and the answer
     * is the second one.
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
        const { send } = buildApi({
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
        const { send } = buildApi({
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
      const { send } = buildApi({
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
      const { send } = buildApi({
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
      const { send } = buildApi({
        projects: { tryGetWithTeam: vi.fn(async () => null) },
      });

      expect((await send("/api/projects/project_doesnotexist")).status).toBe(404);
    });

    it("reports a project in another organization as not found", async () => {
      const { send } = buildApi({
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
      const { send } = buildApi({ projects: { update } });

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
      const { send } = buildApi({ projects: { update } });

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
      const { send } = buildApi({ projects: { update } });

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
      const { send } = buildApi({
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
      const { send } = buildApi({ projects: { update } });

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
      const { send } = buildApi({
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
      const { send } = buildApi({
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
      const { send } = buildApi({ projects: { archive } });

      const response = await send("/api/projects/project_1", { method: "DELETE" });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "project_1",
        name: "My Test Project",
        archivedAt: archivedAt.toISOString(),
      });
      expect(archive).toHaveBeenCalledWith({
        id: "project_1",
        organizationId: ORGANIZATION_ID,
      });
    });

    it("reports an unknown project as not found", async () => {
      const { send } = buildApi({
        projects: {
          archive: vi.fn(async (): Promise<Project> => {
            throw new ProjectNotFoundError();
          }),
        },
      });

      expect((await send("/api/projects/project_nope", { method: "DELETE" })).status).toBe(404);
    });

    it("refuses to archive a personal project", async () => {
      const { send } = buildApi({
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
    /**
     * The route is authorized at the NAMED project's scope, not the
     * organization's, and with `project:update` rather than `project:view` —
     * the key it hands over grants writes, so reading it cannot be cheaper
     * than holding them. The policy is what makes the three scenarios below
     * true, so the policy itself is what is pinned.
     */
    it("declares project:update at the route's own project scope", () => {
      buildApi();

      expect(getRoutePolicy("GET", "/api/projects/:id/api-key")?.policy).toEqual({
        kind: "projectPermission",
        permission: "project:update",
        param: "id",
      });
    });

    /** @scenario A caller who can change the project reads the base key */
    it("hands the base key to a caller who can update that project", async () => {
      const { send } = buildApi({
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
      const { send } = buildApi({
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
      const { send } = buildApi({
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
      const { send } = buildApi({
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
      const { send } = buildApi({
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
      const { send } = buildApi({
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
});
