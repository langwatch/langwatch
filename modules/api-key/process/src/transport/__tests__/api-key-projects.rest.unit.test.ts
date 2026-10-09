/**
 * @vitest-environment node
 * `GET`/`POST /api/projects` at project's path: origin/main's statuses and bodies,
 * over the real provisioning service through the operations-only proxy.
 * Spec: specs/projects/projects-management-door.feature
 */
import type { ApiKey, ApiKeyApi, ApiKeyVisibleProjects } from "@langwatch/api-key-contract";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  ForbiddenError,
  UnauthorizedError,
} from "@langwatch/api/rest";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { LocalFeatureApis } from "@langwatch/process";
import {
  PersonalWorkspaceBoundaryError,
  ProjectSlugConflictError,
  TeamNotInOrganizationError,
  type PaginatedProjects,
  type Project,
  type ProjectApi,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { ProjectProvisioningService } from "../../services/project-provisioning.service.ts";
import { apiKeyProjectsRest, ApiKeyProjectsDoorApi } from "../api-key-projects.rest.ts";
import { apiKeyRestCredential } from "../api-key.rest.ts";

const ORGANIZATION_ID = "organization-1";
const USER_ID = "user-1";
const API_KEY_ID = "api-key-1";
const CREDENTIAL = "organization-credential";
const NOW = new Date("2026-08-24T00:00:00.000Z");
const JOINED = Temporal.Instant.from("2026-08-24T00:00:00Z");

const EVERY_PERMISSION = ["project:create", "project:view"] as const;

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

function page(data: Project[], total = data.length): PaginatedProjects {
  return { data, pagination: { page: 1, limit: 50, total } };
}

/** The key the api-key boundary answers a service-key mint with. */
const MINTED = { token: "sk-lw-service-token", apiKey: { id: "api-key-service" } as ApiKey };

const SEES_EVERYTHING: ApiKeyVisibleProjects = { kind: "all" };

/**
 * The family over the real provisioning service, its two boundaries faked
 * operation by operation, bound to the door token and reached through the
 * same operations-only proxy `transport-mounting` uses at boot.
 */
function mount(
  options: {
    apiKeys?: Partial<Pick<ApiKeyApi, "create" | "resolveVisibleProjects">>;
    projects?: Partial<Pick<ProjectApi, "createInOrganization" | "listByOrganization">>;
    granted?: readonly string[];
    /** The key owner's organisation role; `null` for a non-member. */
    ownerRole?: string | null;
    /** The key's owner; `null` for a service key. */
    ownerUserId?: string | null;
  } = {},
) {
  const ownerRole = options.ownerRole === undefined ? "ADMIN" : options.ownerRole;
  const ownerUserId = options.ownerUserId === undefined ? USER_ID : options.ownerUserId;
  const provisioning = ProjectProvisioningService.create({
    apiKeys: createApiFixture<ApiKeyApi>(
      { resolveVisibleProjects: async () => SEES_EVERYTHING, ...options.apiKeys },
      "ApiKeyApi",
    ),
    organizations: createApiFixture<OrganizationApi>(
      {
        isMember: async () => ownerRole !== null,
        getMember: async () => ({
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          role: ownerRole ?? "MEMBER",
          disabledAt: null,
          createdAt: JOINED,
          updatedAt: JOINED,
          user: { id: USER_ID, name: null, email: null },
          teams: [],
        }),
      },
      "OrganizationApi",
    ),
    projects: createApiFixture<ProjectApi>({ ...options.projects }, "ProjectApi"),
  });
  const door: ApiKeyProjectsDoorApi = {
    listVisibleProjects: (input) => provisioning.listVisibleProjects(input),
    provisionProject: (input) => provisioning.provisionProject(input),
  };
  const apis = new LocalFeatureApis();
  apis.declare(ApiKeyProjectsDoorApi);
  apis.bind(ApiKeyProjectsDoorApi, door);
  apis.ready();
  const granted = new Set<string>(options.granted ?? EVERY_PERMISSION);

  const admit = (request: Request) => {
    if (request.headers.get("Authorization") !== `Bearer ${CREDENTIAL}`) {
      throw new UnauthorizedError("Invalid credential");
    }

    return {
      actor: { type: "user", id: USER_ID } as const,
      scope: { tier: "organization", id: ORGANIZATION_ID } as const,
    };
  };

  const runtime = createRestRuntime({
    authorization: restTestAuthorization(),
    identity: {
      identify: ({ request }) => admit(request),
      authenticate: ({ request, permission }) => {
        const caller = admit(request);
        if (!granted.has(permission)) throw new ForbiddenError("Missing permission");

        return caller;
      },
    },
  });

  const hono = runtime.mount(apiKeyProjectsRest.router(), {
    app: () => apis.reference(ApiKeyProjectsDoorApi),
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(apiKeyRestCredential, () => ({
        apiKeyId: API_KEY_ID,
        userId: ownerUserId,
      })),
    ],
  });

  const send = (
    path: string,
    init: { method?: string; body?: unknown; credential?: string } = {},
  ) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${init.credential ?? CREDENTIAL}`,
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { hono, send };
}

const BODY = {
  name: "My Test Project",
  teamId: "team-1",
  language: "python",
  framework: "langchain",
};

describe("the projects collection, served by api-key", () => {
  describe("given the declaration a process mounts", () => {
    const declaration = apiKeyProjectsRest.router();

    it("keeps project's paths, operation ids, permissions and statuses", () => {
      expect(
        declaration.routes.map((route) => [
          route.method,
          route.path,
          route.operation,
          route.permission ?? route.access?.kind,
          route.status,
          route.sharedPath?.owner,
        ]),
      ).toEqual([
        ["get", "/api/projects", "listProjects", "authenticated", undefined, "project"],
        ["post", "/api/projects", "createProject", "project:create", 201, "project"],
      ]);
      expect([declaration.credential, declaration.addressing, declaration.v1Twin]).toEqual([
        "organization",
        "literal",
        false,
      ]);
    });
  });

  describe("given no credential", () => {
    it("refuses before the request reaches the application", async () => {
      const listByOrganization = vi.fn(async () => page([]));
      const { hono } = mount({ projects: { listByOrganization } });

      const response = await hono.request("/api/projects");

      expect(response.status).toBe(401);
      expect(listByOrganization).not.toHaveBeenCalled();
    });

    it("refuses a credential it does not recognise", async () => {
      const { send } = mount();

      expect((await send("/api/projects", { credential: "sk-lw-invalid_token" })).status).toBe(401);
    });
  });

  describe("when a project is provisioned", () => {
    /** @scenario "provisioning answers with a service key and never the base key" */
    it("answers 201 with a freshly minted service key and no base key", async () => {
      const createInOrganization = vi.fn(async () => project());
      const create = vi.fn(async () => MINTED);
      const { send } = mount({ projects: { createInOrganization }, apiKeys: { create } });

      const response = await send("/api/projects", { method: "POST", body: BODY });

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
      expect(body).not.toHaveProperty("lwqlKey");
      expect(createInOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, userId: USER_ID }),
      );
      expect(create).toHaveBeenCalledWith({
        name: "My Test Project Service Key",
        userId: null,
        createdByUserId: USER_ID,
        organizationId: ORGANIZATION_ID,
        permissionMode: "all",
        bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: "project_1" }],
      });
    });

    it("provisions into a new team when the request names one instead of an id", async () => {
      const createInOrganization = vi.fn(async () => project({ teamId: "team-new" }));
      const { send } = mount({
        projects: { createInOrganization },
        apiKeys: { create: async () => MINTED },
      });

      const response = await send("/api/projects", {
        method: "POST",
        body: {
          name: "New",
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

    it("answers 422 for a body with no name, or naming no team, and creates nothing", async () => {
      const createInOrganization = vi.fn(async () => project());
      const { send } = mount({ projects: { createInOrganization } });

      const noName = { teamId: "team-1", language: "python", framework: "langchain" };
      const noTeam = { name: "No Team", language: "python", framework: "langchain" };

      expect((await send("/api/projects", { method: "POST", body: noName })).status).toBe(422);
      expect((await send("/api/projects", { method: "POST", body: noTeam })).status).toBe(422);
      expect(createInOrganization).not.toHaveBeenCalled();
    });

    it("answers 400 for a team outside the organization", async () => {
      const { send } = mount({
        projects: {
          createInOrganization: async () => {
            throw new TeamNotInOrganizationError("Team does not belong to this organization");
          },
        },
      });

      expect((await send("/api/projects", { method: "POST", body: BODY })).status).toBe(400);
    });

    it("answers 403 at a personal-workspace boundary and a flat 409 for a slug clash", async () => {
      const boundary = mount({
        projects: {
          createInOrganization: async () => {
            throw new PersonalWorkspaceBoundaryError("Not managed here");
          },
        },
      });
      const clash = mount({
        projects: {
          createInOrganization: async () => {
            throw new ProjectSlugConflictError("Slug already taken");
          },
        },
      });

      expect((await boundary.send("/api/projects", { method: "POST", body: BODY })).status).toBe(
        403,
      );
      const conflict = await clash.send("/api/projects", { method: "POST", body: BODY });
      expect(conflict.status).toBe(409);
      await expect(conflict.json()).resolves.toMatchObject({ code: "conflict" });
    });

    it("answers 403 to a caller without project:create, and creates nothing", async () => {
      const createInOrganization = vi.fn(async () => project());
      const { send } = mount({ projects: { createInOrganization }, granted: ["project:view"] });

      expect((await send("/api/projects", { method: "POST", body: BODY })).status).toBe(403);
      expect(createInOrganization).not.toHaveBeenCalled();
    });
  });

  describe("when the collection is listed", () => {
    /** @scenario "the management door reaches the application the composition built" */
    /** @scenario Listing projects never discloses base keys */
    it("answers 200 with the page and never discloses a base key", async () => {
      const listByOrganization = vi.fn(async () => page([project(), project({ id: "project_2" })]));
      const { send } = mount({ projects: { listByOrganization } });

      const response = await send("/api/projects");

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: Record<string, unknown>[];
        pagination: { page: number; limit: number; total: number };
      };
      expect(body.data.map((row) => row.id)).toEqual(["project_1", "project_2"]);
      expect(body.pagination).toEqual({ page: 1, limit: 50, total: 2 });
      for (const row of body.data) {
        expect(row).not.toHaveProperty("apiKey");
        expect(row).not.toHaveProperty("lwqlKey");
      }
      expect(JSON.stringify(body)).not.toContain(project().apiKey);
    });

    it("passes the requested page and limit through", async () => {
      const listByOrganization = vi.fn(async () => page([], 0));
      const { send } = mount({ projects: { listByOrganization } });

      await send("/api/projects?page=2&limit=2");

      expect(listByOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORGANIZATION_ID, page: 2, limit: 2 }),
      );
    });

    /** @scenario "project-scoped key gets a filtered list, not a refusal" */
    it("narrows the query to the projects the key reaches and answers 200", async () => {
      const listByOrganization = vi.fn(async () => page([project()], 1));
      const resolveVisibleProjects = vi.fn(async (): Promise<ApiKeyVisibleProjects> => ({
        kind: "some",
        ids: ["project_1", "project_9"],
      }));
      const { send } = mount({
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
        hiddenKinds: ["internal_governance"],
        projectIds: ["project_1", "project_9"],
      });
    });

    /** @scenario "a key without project:view gets an empty list, not a refusal" */
    it("answers 200 with an empty list when the key reaches nothing", async () => {
      const { send } = mount({
        projects: { listByOrganization: async () => page([], 0) },
        apiKeys: { resolveVisibleProjects: async () => ({ kind: "some", ids: [] }) },
        granted: [],
      });

      const response = await send("/api/projects");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: [],
        pagination: { page: 1, limit: 50, total: 0 },
      });
    });

    /** @scenario "org-scoped key lists every project in the organization" */
    it("leaves the query unfiltered for a key that reaches the organization", async () => {
      const listByOrganization = vi.fn(async () => page([project()]));
      const { send } = mount({ projects: { listByOrganization } });

      await send("/api/projects");

      expect(listByOrganization).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        page: 1,
        limit: 50,
        hiddenKinds: ["internal_governance"],
      });
    });

    describe("when the organization holds an aggregate project", () => {
      it.each([
        ["an admin owner", { ownerRole: "ADMIN" }, ["internal_governance"]],
        ["a member owner", { ownerRole: "MEMBER" }, ["internal_governance", "aggregate"]],
        ["a non-member owner", { ownerRole: null }, ["internal_governance", "aggregate"]],
        ["a service key", { ownerUserId: null }, ["internal_governance", "aggregate"]],
      ] as const)(
        "hides aggregates unless the key acts for an admin: %s",
        async (_, owner, hidden) => {
          const listByOrganization = vi.fn(async () => page([]));
          const { send } = mount({ projects: { listByOrganization }, ...owner });

          expect((await send("/api/projects")).status).toBe(200);
          expect(listByOrganization).toHaveBeenCalledWith(
            expect.objectContaining({ hiddenKinds: hidden }),
          );
        },
      );
    });
  });
});
