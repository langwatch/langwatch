import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  ProjectsApiService,
  ProjectsApiError,
} from "../projects-api.service";

const TEST_ENDPOINT = "http://localhost:5560";

function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "proj_abc123",
    name: "Test Project",
    slug: "test-project",
    language: "python",
    framework: "langchain",
    teamId: "team_xyz",
    piiRedactionLevel: "ESSENTIAL",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const server = setupServer();

describe("ProjectsApiService", () => {
  let service: ProjectsApiService;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" });
    service = new ProjectsApiService({
      apiKey: "test-org-key",
      endpoint: TEST_ENDPOINT,
    });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe("list()", () => {
    describe("when the API returns a paginated list", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/projects`, () => {
            return HttpResponse.json({
              data: [
                projectFixture({ id: "p1", name: "Project 1" }),
                projectFixture({ id: "p2", name: "Project 2" }),
              ],
              pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
            });
          }),
        );
      });

      it("returns projects with pagination metadata", async () => {
        const result = await service.list();

        expect(result.data).toHaveLength(2);
        expect(result.data[0]!.name).toBe("Project 1");
        expect(result.pagination.total).toBe(2);
      });
    });

    describe("when pagination params are provided", () => {
      it("passes page and limit as query params", async () => {
        let capturedUrl = "";
        server.use(
          http.get(`${TEST_ENDPOINT}/api/projects`, ({ request }) => {
            capturedUrl = request.url;
            return HttpResponse.json({
              data: [],
              pagination: { page: 2, limit: 10, total: 15, totalPages: 2 },
            });
          }),
        );

        await service.list({ page: 2, limit: 10 });

        const url = new URL(capturedUrl);
        expect(url.searchParams.get("page")).toBe("2");
        expect(url.searchParams.get("limit")).toBe("10");
      });
    });

    describe("when the API returns an error", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/projects`, () => {
            return HttpResponse.json(
              { error: "Unauthorized", message: "Invalid API key" },
              { status: 401 },
            );
          }),
        );
      });

      it("throws ProjectsApiError", async () => {
        await expect(service.list()).rejects.toThrow(ProjectsApiError);
      });
    });
  });

  describe("get()", () => {
    describe("when the project exists", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/projects/proj_abc123`, () => {
            return HttpResponse.json(projectFixture());
          }),
        );
      });

      it("returns the project", async () => {
        const project = await service.get("proj_abc123");

        expect(project.id).toBe("proj_abc123");
        expect(project.name).toBe("Test Project");
        expect(project.language).toBe("python");
      });
    });

    describe("when the project does not exist", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/projects/nonexistent`, () => {
            return HttpResponse.json(
              { error: "Not Found", message: "Project not found" },
              { status: 404 },
            );
          }),
        );
      });

      it("throws ProjectsApiError", async () => {
        await expect(service.get("nonexistent")).rejects.toThrow(ProjectsApiError);
      });
    });
  });

  describe("create()", () => {
    describe("when valid input is provided", () => {
      beforeEach(() => {
        server.use(
          http.post(`${TEST_ENDPOINT}/api/projects`, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json(
              {
                ...projectFixture({ name: body.name as string }),
                serviceApiKey: "sk-lw-test_secret",
                serviceApiKeyId: "key_123",
              },
              { status: 201 },
            );
          }),
        );
      });

      it("creates project and returns service API key", async () => {
        const result = await service.create({
          name: "New Project",
          language: "typescript",
          framework: "openai",
          newTeamName: "My Team",
        });

        expect(result.name).toBe("New Project");
        expect(result.serviceApiKey).toBe("sk-lw-test_secret");
        expect(result.serviceApiKeyId).toBe("key_123");
      });
    });

    describe("when a slug conflict occurs", () => {
      beforeEach(() => {
        server.use(
          http.post(`${TEST_ENDPOINT}/api/projects`, () => {
            return HttpResponse.json(
              { error: "Conflict", message: "Project slug already exists" },
              { status: 409 },
            );
          }),
        );
      });

      it("throws ProjectsApiError", async () => {
        await expect(
          service.create({
            name: "Duplicate",
            language: "python",
            framework: "langchain",
            newTeamName: "Team",
          }),
        ).rejects.toThrow(ProjectsApiError);
      });
    });
  });

  describe("update()", () => {
    describe("when valid fields are provided", () => {
      beforeEach(() => {
        server.use(
          http.patch(`${TEST_ENDPOINT}/api/projects/proj_abc123`, () => {
            return HttpResponse.json(
              projectFixture({ name: "Updated Name" }),
            );
          }),
        );
      });

      it("returns the updated project", async () => {
        const updated = await service.update("proj_abc123", { name: "Updated Name" });

        expect(updated.name).toBe("Updated Name");
      });
    });
  });

  describe("archive()", () => {
    describe("when the project exists", () => {
      beforeEach(() => {
        server.use(
          http.delete(`${TEST_ENDPOINT}/api/projects/proj_abc123`, () => {
            return HttpResponse.json({
              id: "proj_abc123",
              name: "Test Project",
              archivedAt: "2025-06-01T00:00:00Z",
            });
          }),
        );
      });

      it("returns archived project with timestamp", async () => {
        const result = await service.archive("proj_abc123");

        expect(result.id).toBe("proj_abc123");
        expect(result.archivedAt).toBe("2025-06-01T00:00:00Z");
      });
    });
  });

  describe("auth header", () => {
    it("sends Authorization Bearer header", async () => {
      let capturedAuth = "";
      server.use(
        http.get(`${TEST_ENDPOINT}/api/projects`, ({ request }) => {
          capturedAuth = request.headers.get("authorization") ?? "";
          return HttpResponse.json({
            data: [],
            pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
          });
        }),
      );

      await service.list();

      expect(capturedAuth).toBe("Bearer test-org-key");
    });
  });
});
