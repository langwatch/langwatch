import { SecretDuplicateError, SecretNotFoundError } from "@langwatch/secret-contract";
import { generateSpecs } from "hono-openapi";
import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
const get = vi.fn();
const list = vi.fn();
let authenticatedUserId: string | undefined = "user-1";

const secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "MY_SECRET",
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

const langwatchApp = {
  secrets: { create, delete: vi.fn(), get, getValues: vi.fn(), list, update: vi.fn() },
};

vi.mock("~/app/api/middleware/app-context", () => {
  const middleware: MiddlewareHandler = async (context, next) => {
    Object.defineProperty(context, "app", { configurable: true, value: langwatchApp });
    await next();
  };

  return { appContextMiddleware: middleware, appFromContext: () => langwatchApp };
});

vi.mock("~/app/api/middleware/auth", () => {
  const middleware: MiddlewareHandler = async (context, next) => {
    context.set("project", { id: "project-1", teamId: "team-1", name: "Test Project" });
    context.set("resolvedToken", { kind: "legacy" });
    if (authenticatedUserId) context.set("apiKeyUserId", authenticatedUserId);
    await next();
  };

  return {
    authMiddleware: middleware,
    canonicalAuthMiddleware: middleware,
    requirePermission: () => async (_context: unknown, next: () => Promise<void>) => next(),
  };
});

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api-key/auth-middleware")>()),
  enforceApiKeyCeiling: vi.fn().mockResolvedValue(undefined),
}));

import { createSecretLegacyRestApp } from "@langwatch/platform-api";
import { appRestSecurity } from "~/server/api/security";

const { hono: app } = createSecretLegacyRestApp({
  security: appRestSecurity,
  secrets: () => langwatchApp.secrets as never,
});

describe("Secret legacy API compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticatedUserId = "user-1";
    create.mockResolvedValue(secret);
    get.mockResolvedValue(secret);
    list.mockResolvedValue([secret]);
    langwatchApp.secrets.update.mockResolvedValue(secret);
    langwatchApp.secrets.delete.mockResolvedValue(undefined);
  });

  /** @scenario "Legacy REST remains a thin compatibility transport" */
  it("keeps the unversioned REST DTO, warning, and actor attribution", async () => {
    const response = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "MY_SECRET", value: "secret-value" }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Warning")).toContain("deprecated");
    expect(response.headers.get("X-API-Deprecation-Notice")).toContain("/api/v1/secret");
    await expect(response.json()).resolves.toEqual({
      id: "secret-1",
      projectId: "project-1",
      name: "MY_SECRET",
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    });
    expect(create).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "MY_SECRET",
      value: "secret-value",
      actorId: "user-1",
    });
  });

  it("keeps legacy REST domain error status and body mappings", async () => {
    get.mockRejectedValueOnce(new SecretNotFoundError());
    const missing = await app.request("/api/secrets/missing");

    create.mockRejectedValueOnce(new SecretDuplicateError("MY_SECRET"));
    const duplicate = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "MY_SECRET", value: "secret-value" }),
    });

    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "Secret not found" });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({
      error: 'A secret with the name "MY_SECRET" already exists in this project',
    });
  });

  it("does not expose the removed public RPC family", async () => {
    const response = await app.request("/api/secrets/latest/secrets.create", { method: "POST" });

    expect(response.status).toBe(404);
  });

  it("accepts the supported header version and rejects an unknown one", async () => {
    const selected = await app.request("/api/secrets", {
      headers: { "X-API-Version": "v1" },
    });
    const invalid = await app.request("/api/secrets", {
      headers: { "X-API-Version": "v2" },
    });

    expect(selected.status).toBe(200);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: "invalid_api_version" });
  });

  it("keeps every deployed plural collection and item operation live", async () => {
    const listResponse = await app.request("/api/secrets");
    const getResponse = await app.request("/api/secrets/secret-1");
    const createResponse = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "MY_SECRET", value: "secret-value" }),
    });
    const updateResponse = await app.request("/api/secrets/secret-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "replacement-secret-value" }),
    });
    const deleteResponse = await app.request("/api/secrets/secret-1", { method: "DELETE" });

    expect([
      listResponse.status,
      getResponse.status,
      createResponse.status,
      updateResponse.status,
      deleteResponse.status,
    ]).toEqual([200, 200, 201, 200, 200]);
  });

  it("publishes the deployed five-operation legacy REST surface, not public RPC", async () => {
    const specification = await generateSpecs(app);
    const paths = specification.paths ?? {};

    expect(paths["/api/secrets"]?.get?.operationId).toBe("getApiSecrets");
    expect(paths["/api/secrets"]?.post?.operationId).toBe("postApiSecrets");
    expect(paths["/api/secrets/{id}"]?.get?.operationId).toBe("getApiSecretsById");
    expect(paths["/api/secrets/{id}"]?.put?.operationId).toBe("putApiSecretsById");
    expect(paths["/api/secrets/{id}"]?.delete?.operationId).toBe("deleteApiSecretsById");
    expect(Object.keys(paths)).not.toContain("/api/secrets/latest/secrets.create");
  });

  it("refuses writes without an authenticated user actor", async () => {
    authenticatedUserId = undefined;
    const response = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "MY_SECRET", value: "secret-value" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "authenticated_actor_required" });
    expect(create).not.toHaveBeenCalled();
  });
});
