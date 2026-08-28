import { generateApiSpecs } from "@langwatch/api";
import { HandledError } from "@langwatch/handled-error";
import { SecretReservedNameError } from "@langwatch/secret-contract";
import type { MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const contractState = vi.hoisted(() => ({ invalidOutput: false }));

const create = vi.fn();
let authentication = "allowed" as "allowed" | "missing";
let permission = "allowed" as "allowed" | "denied";
let authenticatedUserId: string | undefined = "user-1";
let authenticatedProjectId = "project-1";

class TestAuthenticationError extends HandledError {
  constructor() {
    super("missing_credentials", "Authentication required", { httpStatus: 401, fault: "customer" });
    this.name = "TestAuthenticationError";
  }
}

class TestPermissionError extends HandledError {
  constructor() {
    super("api_key_permission_denied", "Permission denied", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "TestPermissionError";
  }
}

vi.mock("@langwatch/secret-contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/secret-contract")>();
  return {
    ...actual,
    toSecretPublic(secret: Parameters<typeof actual.toSecretPublic>[0]) {
      const metadata = actual.toSecretPublic(secret);
      return contractState.invalidOutput ? { ...metadata, unexpected: true } : metadata;
    },
  };
});

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
  secrets: {
    create,
    delete: vi.fn(),
    get: vi.fn(),
    getValues: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("~/app/api/middleware/app-context", () => {
  const middleware: MiddlewareHandler = async (context, next) => {
    Object.defineProperty(context, "app", {
      configurable: true,
      value: langwatchApp,
    });
    await next();
  };

  return {
    appContextMiddleware: middleware,
    appFromContext: () => langwatchApp,
  };
});

vi.mock("~/app/api/middleware/auth", () => ({
  modernRestAuthMiddleware: (async (context, next) => {
    if (authentication === "missing") {
      throw new TestAuthenticationError();
    }

    context.set("project", {
      id: authenticatedProjectId,
      teamId: "team-1",
      name: "Test Project",
    });
    context.set("resolvedToken", { kind: "legacy" });
    if (authenticatedUserId) {
      context.set("apiKeyUserId", authenticatedUserId);
    }
    await next();
  }) satisfies MiddlewareHandler,
  requirePermissionOrThrow: () =>
    (async (context, next) => {
      if (permission === "denied") {
        throw new TestPermissionError();
      }
      await next();
    }) satisfies MiddlewareHandler,
}));

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api-key/auth-middleware")>()),
  enforceApiKeyCeiling: vi.fn().mockResolvedValue(undefined),
}));

import { secretPublicRestApp as app } from "~/runtime/app/features/secret";

describe("Secret modern REST composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authentication = "allowed";
    permission = "allowed";
    authenticatedUserId = "user-1";
    authenticatedProjectId = "project-1";
    contractState.invalidOutput = false;
    create.mockResolvedValue(secret);
    langwatchApp.secrets.list.mockResolvedValue([secret]);
    langwatchApp.secrets.get.mockResolvedValue(secret);
    langwatchApp.secrets.update.mockResolvedValue(secret);
  });

  /** @scenario "Every transport uses one service" */
  /** @scenario "The modern public API is validated REST" */
  it("serves every direct modern collection alias", async () => {
    const v1Singular = await app.request("/api/v1/secret?projectId=project-1");
    const v1Plural = await app.request("/api/v1/secrets?projectId=project-1");
    const unversionedSingular = await app.request("/api/secret?projectId=project-1");
    const header = await app.request("/api/secret?projectId=project-1", {
      headers: { "X-API-Version": "v1" },
    });

    expect(v1Singular.status).toBe(200);
    expect(v1Plural.status).toBe(200);
    expect(unversionedSingular.status).toBe(200);
    expect(header.status).toBe(200);
    await expect(header.json()).resolves.toEqual([
      expect.objectContaining({
        id: "secret-1",
        name: "MY_SECRET",
      }),
    ]);
  });

  it.each(["/api/v1/secret", "/api/v1/secrets", "/api/secret"])(
    "%s supports collection and item verbs",
    async (basePath) => {
      const list = await app.request(`${basePath}?projectId=project-1`);
      const get = await app.request(`${basePath}/secret-1?projectId=project-1`);
      const create = await app.request(basePath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          name: "MY_SECRET",
          value: "secret-value",
        }),
      });
      const update = await app.request(`${basePath}/secret-1`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1", value: "replacement-secret-value" }),
      });
      const remove = await app.request(`${basePath}/secret-1`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1" }),
      });

      expect([list.status, get.status, create.status, update.status, remove.status]).toEqual([
        200, 200, 201, 200, 200,
      ]);
    },
  );

  it("selects v1 from the path or header and rejects incompatible version negotiation", async () => {
    const pathVersion = await app.request("/api/v1/secret?projectId=project-1", {
      headers: { "X-API-Version": "v1" },
    });
    const headerVersion = await app.request("/api/secret?projectId=project-1", {
      headers: { "X-API-Version": "v1" },
    });
    const conflict = await app.request("/api/v1/secret?projectId=project-1", {
      headers: { "X-API-Version": "latest" },
    });
    const invalid = await app.request("/api/secret?projectId=project-1", {
      headers: { "X-API-Version": "v2" },
    });
    const removedDatedShape = await app.request(
      "/api/v1/secret/2026-08-24/secrets?projectId=project-1",
    );

    expect(pathVersion.status).toBe(200);
    expect(headerVersion.status).toBe(200);
    expect(conflict.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(removedDatedShape.status).toBe(404);
    await expect(conflict.json()).resolves.toMatchObject({ code: "api_version_conflict" });
    await expect(invalid.json()).resolves.toMatchObject({ code: "invalid_api_version" });
  });

  /** @scenario "An authorised credential chooses a project" */
  /** @scenario "Writes use the authenticated user actor" */
  it("uses the validated project target and authenticated actor for writes", async () => {
    const response = await app.request("/api/v1/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "MY_SECRET",
        value: "secret-value",
      }),
    });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "MY_SECRET",
      value: "secret-value",
      actorId: "user-1",
    });
    await expect(response.json()).resolves.not.toHaveProperty("value");
  });

  it("uses the same validated target for get, update, and delete", async () => {
    const get = await app.request("/api/v1/secret/secret-1?projectId=project-1");
    const update = await app.request("/api/v1/secret/secret-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        value: "replacement-secret-value",
      }),
    });
    const remove = await app.request("/api/v1/secret/secret-1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-1" }),
    });

    expect(get.status).toBe(200);
    expect(update.status).toBe(200);
    expect(remove.status).toBe(200);
    expect(langwatchApp.secrets.get).toHaveBeenCalledWith({
      id: "secret-1",
      projectId: "project-1",
    });
    expect(langwatchApp.secrets.update).toHaveBeenCalledWith({
      actorId: "user-1",
      id: "secret-1",
      projectId: "project-1",
      value: "replacement-secret-value",
    });
    expect(langwatchApp.secrets.delete).toHaveBeenCalledWith({
      id: "secret-1",
      projectId: "project-1",
    });
    await expect(remove.json()).resolves.toEqual({ deleted: true, id: "secret-1" });
  });

  it("returns one flat error body for authentication, permission, and project failures", async () => {
    authentication = "missing";
    const unauthenticated = await app.request("/api/v1/secret?projectId=project-1");

    authentication = "allowed";
    permission = "denied";
    const unauthorized = await app.request("/api/v1/secret?projectId=project-1");

    permission = "allowed";
    const mismatch = await app.request("/api/v1/secret?projectId=other-project");

    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      code: "missing_credentials",
      retryable: false,
    });
    expect(unauthorized.status).toBe(403);
    expect(await unauthorized.json()).toMatchObject({
      code: "api_key_permission_denied",
      retryable: false,
    });
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toMatchObject({
      code: "project_input_mismatch",
      retryable: false,
    });
  });

  it.each(["/api/v1/secret", "/api/v1/secrets", "/api/secret"])(
    "%s keeps authentication, permission, and project-target enforcement",
    async (basePath) => {
      authentication = "missing";
      const unauthenticated = await app.request(`${basePath}?projectId=project-1`);

      authentication = "allowed";
      permission = "denied";
      const unauthorized = await app.request(`${basePath}?projectId=project-1`);

      permission = "allowed";
      const mismatch = await app.request(`${basePath}?projectId=other-project`);

      expect([unauthenticated.status, unauthorized.status, mismatch.status]).toEqual([
        401, 403, 403,
      ]);
      await expect(mismatch.json()).resolves.toMatchObject({ code: "project_input_mismatch" });
    },
  );

  it("uses the authenticated project resolved from the project header", async () => {
    const matching = await app.request("/api/v1/secret?projectId=project-1", {
      headers: { "X-Project-Id": "project-1" },
    });

    authenticatedProjectId = "other-project";
    const mismatch = await app.request("/api/v1/secret?projectId=project-1", {
      headers: { "X-Project-Id": "other-project" },
    });

    expect(matching.status).toBe(200);
    expect(mismatch.status).toBe(403);
    await expect(mismatch.json()).resolves.toMatchObject({ code: "project_input_mismatch" });
  });

  it("refuses a write without an authenticated user actor", async () => {
    authenticatedUserId = undefined;
    const response = await app.request("/api/v1/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "MY_SECRET",
        value: "secret-value",
      }),
    });

    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps validation, domain, output, and unknown failures in the flat error envelope", async () => {
    const validation = await app.request("/api/v1/secret");

    create.mockRejectedValueOnce(new SecretReservedNameError("AWS_SECRET_ACCESS_KEY"));
    const reserved = await app.request("/api/v1/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "AWS_SECRET_ACCESS_KEY",
        value: "must-not-leak",
      }),
    });

    contractState.invalidOutput = true;
    create.mockResolvedValueOnce(secret);
    const invalidOutput = await app.request("/api/v1/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "MY_SECRET",
        value: "must-not-leak",
      }),
    });

    create.mockRejectedValueOnce(new Error("database password must-not-leak"));
    const unknown = await app.request("/api/v1/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "MY_SECRET",
        value: "must-not-leak",
      }),
    });

    expect(validation.status).toBe(422);
    await expect(validation.json()).resolves.toMatchObject({ code: "validation_error" });
    expect(reserved.status).toBe(400);
    const reservedBody = await reserved.text();
    expect(reservedBody).toContain("secret_name_reserved");
    expect(reservedBody).not.toContain("must-not-leak");
    expect(invalidOutput.status).toBe(500);
    await expect(invalidOutput.json()).resolves.toMatchObject({ code: "internal_error" });
    expect(unknown.status).toBe(500);
    const unknownBody = await unknown.text();
    expect(unknownBody).toContain("internal_error");
    expect(unknownBody).not.toContain("must-not-leak");
  });

  it("publishes both modern REST prefixes", async () => {
    const specification = await generateApiSpecs(app, { excludeStaticFile: false });
    const paths = Object.keys(specification.paths ?? {});

    expect(paths).toContain("/api/v1/secret");
    expect(paths).toContain("/api/v1/secret/{id}");
    expect(paths).toContain("/api/v1/secrets");
    expect(paths).toContain("/api/v1/secrets/{id}");
    expect(paths).toContain("/api/secret");
    expect(paths).toContain("/api/secret/{id}");
    expect(paths).not.toContain("/api/v1/secret/secrets");
    expect(paths).not.toContain("/api/v1/secret/2026-08-24");

    const operationIds = Object.values(specification.paths ?? {})
      .flatMap((path) => Object.values(path ?? {}))
      .flatMap((operation) =>
        typeof operation === "object" && operation !== null && "operationId" in operation
          ? [operation.operationId]
          : [],
      );
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
