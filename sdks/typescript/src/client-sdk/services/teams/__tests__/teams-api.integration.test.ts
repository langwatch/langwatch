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
import { TeamsApiService } from "../teams-api.service";
import { LangWatchHandledError } from "@/internal/api/errors";

const TEST_ENDPOINT = "http://localhost:5560";

function teamFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "team_abc123",
    name: "Test Team",
    slug: "test-team",
    organizationId: "org_xyz",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

const server = setupServer();

describe("TeamsApiService", () => {
  let service: TeamsApiService;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" });
    service = new TeamsApiService({
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

  describe("create()", () => {
    describe("when a name is provided", () => {
      let capturedBody: Record<string, unknown> | null = null;

      beforeEach(() => {
        capturedBody = null;
        server.use(
          http.post(`${TEST_ENDPOINT}/api/teams`, async ({ request }) => {
            capturedBody = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json(
              teamFixture({ name: capturedBody.name as string }),
              { status: 201 },
            );
          }),
        );
      });

      /** @scenario Creating a team from the SDK returns the team with its slug */
      it("posts the name and returns the created team", async () => {
        const team = await service.create({ name: "Platform" });

        expect(capturedBody).toEqual({ name: "Platform" });
        expect(team.name).toBe("Platform");
        expect(team.id).toBe("team_abc123");
        expect(team.organizationId).toBe("org_xyz");
      });
    });

    describe("when the API rejects the name", () => {
      beforeEach(() => {
        server.use(
          http.post(`${TEST_ENDPOINT}/api/teams`, () => {
            return HttpResponse.json(
              { error: "Bad Request", message: "name is required" },
              { status: 400 },
            );
          }),
        );
      });

      it("throws LangWatchHandledError", async () => {
        await expect(service.create({ name: "" })).rejects.toThrow(
          LangWatchHandledError,
        );
      });
    });
  });

  describe("list()", () => {
    describe("when the API returns a paginated list", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/teams`, () => {
            return HttpResponse.json({
              data: [
                teamFixture({ id: "t1", name: "Team 1" }),
                teamFixture({ id: "t2", name: "Team 2" }),
              ],
              pagination: { page: 1, limit: 50, total: 2 },
            });
          }),
        );
      });

      it("returns teams with pagination metadata", async () => {
        const result = await service.list();

        expect(result.data).toHaveLength(2);
        expect(result.data[0]!.name).toBe("Team 1");
        expect(result.pagination.total).toBe(2);
      });
    });

    describe("when pagination params are provided", () => {
      it("passes page and limit as query params", async () => {
        let capturedUrl = "";
        server.use(
          http.get(`${TEST_ENDPOINT}/api/teams`, ({ request }) => {
            capturedUrl = request.url;
            return HttpResponse.json({
              data: [],
              pagination: { page: 2, limit: 10, total: 15 },
            });
          }),
        );

        await service.list({ page: 2, limit: 10 });

        const url = new URL(capturedUrl);
        expect(url.searchParams.get("page")).toBe("2");
        expect(url.searchParams.get("limit")).toBe("10");
      });
    });

    describe("when the API rejects the credential", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/teams`, () => {
            return HttpResponse.json(
              { error: "Unauthorized", message: "Invalid API key" },
              { status: 401 },
            );
          }),
        );
      });

      it("throws LangWatchHandledError", async () => {
        await expect(service.list()).rejects.toThrow(LangWatchHandledError);
      });
    });
  });

  describe("archive()", () => {
    describe("when the team exists", () => {
      let capturedMethod = "";

      beforeEach(() => {
        capturedMethod = "";
        server.use(
          http.delete(
            `${TEST_ENDPOINT}/api/teams/team_abc123`,
            ({ request }) => {
              capturedMethod = request.method;
              return HttpResponse.json({
                id: "team_abc123",
                name: "Test Team",
                archivedAt: "2025-02-01T00:00:00Z",
              });
            },
          ),
        );
      });

      it("deletes the team and returns when it was archived", async () => {
        const archived = await service.archive("team_abc123");

        expect(capturedMethod).toBe("DELETE");
        expect(archived.archivedAt).toBe("2025-02-01T00:00:00Z");
      });
    });
  });
});
