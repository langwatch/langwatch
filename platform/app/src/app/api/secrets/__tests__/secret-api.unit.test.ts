import { generateApiSpecs } from "@langwatch/api";
import type { Secret } from "@langwatch/secret-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
let authenticatedUserId: string | undefined = "user-1";

const langwatchApp = {
  secrets: { create },
};

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => langwatchApp,
  tryGetApp: () => langwatchApp,
}));

vi.mock("~/app/api/middleware/app-context", () => ({
  appContextMiddleware: async (context: any, next: any) => {
    Object.defineProperty(context, "app", {
      configurable: true,
      value: langwatchApp,
    });
    await next();
  },
  appFromContext: () => langwatchApp,
}));

vi.mock("~/app/api/middleware/auth", () => ({
  authMiddleware: async (context: any, next: any) => {
    context.set("project", {
      id: "project-1",
      teamId: "team-1",
      name: "Test Project",
    });
    if (authenticatedUserId) {
      context.set("apiKeyUserId", authenticatedUserId);
    }
    await next();
  },
  canonicalAuthMiddleware: async (context: any, next: any) => {
    context.set("project", {
      id: "project-1",
      teamId: "team-1",
      name: "Test Project",
    });
    if (authenticatedUserId) {
      context.set("apiKeyUserId", authenticatedUserId);
    }
    await next();
  },
  requirePermission: () => async (_context: any, next: any) => next(),
}));

vi.mock("~/server/api/rbac", () => ({
  resolveProjectPermission: vi
    .fn()
    .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
}));

vi.mock("~/utils/extend-zod-openapi", () => ({
  patchZodOpenapi: vi.fn(),
}));

import { app } from "../[[...route]]/app";

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "MY_SECRET",
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

describe("Secret API composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticatedUserId = "user-1";
    create.mockResolvedValue(secret);
  });

  it("keeps legacy REST live with a warning and delegates to the App service", async () => {
    const response = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "MY_SECRET", value: "secret-value" }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("Deprecation")).toBe("true");
    expect(response.headers.get("Warning")).toContain("deprecated");
    expect(response.headers.get("X-API-Deprecation-Notice")).toContain(
      "/api/secrets/latest/secrets.*",
    );
    expect(create).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "MY_SECRET",
      value: "secret-value",
      actorId: "user-1",
    });
  });

  it("refuses a legacy write without an authenticated user actor", async () => {
    authenticatedUserId = undefined;

    const response = await app.request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "MY_SECRET", value: "secret-value" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "authenticated_actor_required",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("serves the modern RPC API from the same App service", async () => {
    const response = await app.request("/api/secrets/latest/secrets.create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "MY_SECRET",
        value: "secret-value",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "secret-1",
      name: "MY_SECRET",
    });
    expect(create).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "MY_SECRET",
      value: "secret-value",
      actorId: "user-1",
    });
  });

  it("requires a real user actor only when a modern write asks for it", async () => {
    authenticatedUserId = undefined;

    const response = await app.request("/api/secrets/latest/secrets.create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "MY_SECRET",
        value: "secret-value",
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "authenticated_actor_required",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a requested project different from the authenticated project", async () => {
    const response = await app.request("/api/secrets/latest/secrets.list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "another-project" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "project_input_mismatch",
    });
  });

  it("publishes RPC operations but no legacy REST operation", async () => {
    const specification = await generateApiSpecs(app, {
      excludeStaticFile: false,
    });
    const paths = Object.keys(specification.paths ?? {});

    expect(paths).toContain("/api/secrets/latest/secrets.create");
    expect(paths).not.toContain("/api/secrets");
    expect(paths).not.toContain("/api/secrets/{id}");
  });
});
