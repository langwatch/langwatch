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
  ApiKeysApiService,
  ApiKeysApiError,
} from "../api-keys-api.service";

const TEST_ENDPOINT = "http://localhost:5560";

function apiKeyFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "key_abc123",
    name: "Test Key",
    description: null,
    createdAt: "2025-01-01T00:00:00Z",
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    roleBindings: [
      {
        id: "rb_1",
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: "org_xyz",
      },
    ],
    ...overrides,
  };
}

const server = setupServer();

describe("ApiKeysApiService", () => {
  let service: ApiKeysApiService;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" });
    service = new ApiKeysApiService({
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
    describe("when the API returns keys", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/api-keys`, () => {
            return HttpResponse.json({
              data: [
                apiKeyFixture({ id: "k1", name: "Key 1" }),
                apiKeyFixture({ id: "k2", name: "Key 2", revokedAt: "2025-03-01T00:00:00Z" }),
              ],
            });
          }),
        );
      });

      it("returns all API keys", async () => {
        const keys = await service.list();

        expect(keys).toHaveLength(2);
        expect(keys[0]!.name).toBe("Key 1");
        expect(keys[0]!.revokedAt).toBeNull();
        expect(keys[1]!.revokedAt).toBe("2025-03-01T00:00:00Z");
      });
    });

    describe("when no keys exist", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/api-keys`, () => {
            return HttpResponse.json({ data: [] });
          }),
        );
      });

      it("returns empty array", async () => {
        const keys = await service.list();
        expect(keys).toHaveLength(0);
      });
    });

    describe("when the API returns an error", () => {
      beforeEach(() => {
        server.use(
          http.get(`${TEST_ENDPOINT}/api/api-keys`, () => {
            return HttpResponse.json(
              { error: "Unauthorized", message: "Invalid API key" },
              { status: 401 },
            );
          }),
        );
      });

      it("throws ApiKeysApiError", async () => {
        await expect(service.list()).rejects.toThrow(ApiKeysApiError);
      });
    });
  });

  describe("create()", () => {
    describe("when creating a service key", () => {
      beforeEach(() => {
        server.use(
          http.post(`${TEST_ENDPOINT}/api/api-keys`, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json(
              {
                token: "sk-lw-new_service_key",
                apiKey: {
                  id: "key_new",
                  name: body.name as string,
                  createdAt: "2025-06-01T00:00:00Z",
                },
              },
              { status: 201 },
            );
          }),
        );
      });

      it("returns token and key metadata", async () => {
        const result = await service.create({
          keyType: "service",
          name: "CI Key",
        });

        expect(result.token).toBe("sk-lw-new_service_key");
        expect(result.apiKey.name).toBe("CI Key");
        expect(result.apiKey.id).toBe("key_new");
      });
    });

    describe("when creating a key with project scope", () => {
      it("sends projectIds in the request body", async () => {
        let capturedBody: Record<string, unknown> = {};
        server.use(
          http.post(`${TEST_ENDPOINT}/api/api-keys`, async ({ request }) => {
            capturedBody = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json(
              {
                token: "sk-lw-scoped_key",
                apiKey: { id: "key_s", name: "Scoped", createdAt: "2025-06-01T00:00:00Z" },
              },
              { status: 201 },
            );
          }),
        );

        await service.create({
          keyType: "service",
          name: "Scoped",
          projectIds: ["proj_1", "proj_2"],
        });

        expect(capturedBody.projectIds).toEqual(["proj_1", "proj_2"]);
      });
    });

    describe("when permissions are insufficient", () => {
      beforeEach(() => {
        server.use(
          http.post(`${TEST_ENDPOINT}/api/api-keys`, () => {
            return HttpResponse.json(
              { error: "Forbidden", message: "Insufficient permissions" },
              { status: 403 },
            );
          }),
        );
      });

      it("throws ApiKeysApiError", async () => {
        await expect(
          service.create({ name: "Nope", keyType: "personal" }),
        ).rejects.toThrow(ApiKeysApiError);
      });
    });
  });

  describe("revoke()", () => {
    describe("when the key exists", () => {
      beforeEach(() => {
        server.use(
          http.delete(`${TEST_ENDPOINT}/api/api-keys/key_abc123`, () => {
            return HttpResponse.json({ success: true });
          }),
        );
      });

      it("returns success", async () => {
        const result = await service.revoke("key_abc123");
        expect(result.success).toBe(true);
      });
    });

    describe("when the key does not exist", () => {
      beforeEach(() => {
        server.use(
          http.delete(`${TEST_ENDPOINT}/api/api-keys/nonexistent`, () => {
            return HttpResponse.json(
              { error: "Not Found", message: "API key not found" },
              { status: 404 },
            );
          }),
        );
      });

      it("throws ApiKeysApiError", async () => {
        await expect(service.revoke("nonexistent")).rejects.toThrow(ApiKeysApiError);
      });
    });

    describe("when the key is already revoked", () => {
      beforeEach(() => {
        server.use(
          http.delete(`${TEST_ENDPOINT}/api/api-keys/key_revoked`, () => {
            return HttpResponse.json(
              { error: "Conflict", message: "API key already revoked" },
              { status: 409 },
            );
          }),
        );
      });

      it("throws ApiKeysApiError", async () => {
        await expect(service.revoke("key_revoked")).rejects.toThrow(ApiKeysApiError);
      });
    });
  });

  describe("auth header", () => {
    it("sends Authorization Bearer header", async () => {
      let capturedAuth = "";
      server.use(
        http.get(`${TEST_ENDPOINT}/api/api-keys`, ({ request }) => {
          capturedAuth = request.headers.get("authorization") ?? "";
          return HttpResponse.json({ data: [] });
        }),
      );

      await service.list();

      expect(capturedAuth).toBe("Bearer test-org-key");
    });
  });
});
