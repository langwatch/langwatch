import { type ApiKeyApi, type ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import type { Secret, SecretApi } from "@langwatch/secret-contract";
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiApplication, NoApiTrpcFeatures } from "../api.application.ts";
import { ApiHttpListener } from "../api-http.listener.ts";
import { ApiHandlerManagedCredentials } from "../app/api-handler-managed-credential.ts";
import { openTestRestDoors } from "../app-rest/__tests__/support/rest-doors.harness.ts";

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "OPENAI_API_KEY",
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

const currentKey: ResolvedApiKeyCredential = {
  type: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "org-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project: {
    id: "project-1",
    name: "Project one",
    slug: "project-one",
    teamId: "team-1",
    organizationId: "org-1",
    isPersonal: false,
    ownerUserId: null,
  },
};

/** The credentials every request carries; the real door refuses without them. */
const credentials = {
  authorization: "Bearer current-token",
  "X-Project-Id": "project-1",
};

const running: ApiHttpListener[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((listener) => listener.close()));
});

describe("standalone Secret REST listener", () => {
  /** @scenario "Every transport uses one service" */
  /** @scenario "Legacy REST remains a thin compatibility transport" */
  it("serves every deployed collection and item operation through each Secret base path", async () => {
    const api = await startApi();
    const bases = ["/api/v1/secret", "/api/v1/secrets", "/api/secret", "/api/secrets"];

    for (const base of bases) {
      const collection = await api.fetch(`${base}?projectId=project-1`, {
        headers: { ...credentials },
      });
      const create = await api.fetch(base, {
        method: "POST",
        headers: { ...credentials, "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          name: "OPENAI_API_KEY",
          value: "secret-value",
        }),
      });
      const item = await api.fetch(`${base}/secret-1?projectId=project-1`, {
        headers: { ...credentials },
      });
      const update = await api.fetch(`${base}/secret-1`, {
        method: "PUT",
        headers: { ...credentials, "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          value: "replacement-secret-value",
        }),
      });
      const remove = await api.fetch(`${base}/secret-1`, {
        method: "DELETE",
        headers: { ...credentials, "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1" }),
      });

      expect([collection.status, create.status, item.status, update.status, remove.status]).toEqual(
        [200, 201, 200, 200, 200],
      );
      await expect(collection.json()).resolves.toEqual([publicSecret]);
      await expect(create.json()).resolves.toEqual(publicSecret);
      await expect(item.json()).resolves.toEqual(publicSecret);
      await expect(update.json()).resolves.toEqual(publicSecret);
      await expect(remove.json()).resolves.toEqual({ id: "secret-1", deleted: true });
    }

    expect(api.calls.list).toHaveBeenCalledTimes(bases.length);
    expect(api.calls.get).toHaveBeenCalledTimes(bases.length);
    expect(api.calls.create).toHaveBeenCalledTimes(bases.length);
    expect(api.calls.update).toHaveBeenCalledTimes(bases.length);
    expect(api.calls.delete).toHaveBeenCalledTimes(bases.length);
    expect(api.authz.hasApiKeyPermission).toHaveBeenCalledTimes(bases.length * 5);
  });

  /** @scenario "A caller may not reach a scope their credential does not cover" */
  it("refuses a project the credential does not cover without saying whether it exists", async () => {
    const api = await startApi();

    const wrongProject = await api.fetch("/api/secret?projectId=project-2", {
      headers: { ...credentials },
    });

    expect(wrongProject.status).toBe(403);
    const body = (await wrongProject.text()).toLowerCase();
    // The refusal is the same whether or not project-2 is real, so it must not
    // name it, quote it back, or say it was not found.
    expect(body).not.toContain("project-2");
    expect(body).not.toContain("not found");
    expect(api.calls.list).not.toHaveBeenCalled();
  });

  /** @scenario "An authorised credential chooses a project" */
  /** @scenario "Writes use the authenticated user actor" */
  it("resolves the credential, checks the declared permission and attributes the write", async () => {
    const api = await startApi();
    const response = await api.fetch("/api/v1/secret", {
      method: "POST",
      headers: { ...credentials, "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "OPENAI_API_KEY",
        value: "secret-value",
      }),
    });

    expect(response.status).toBe(201);
    expect(api.apiKeys.findResolvedToken).toHaveBeenCalledExactlyOnceWith({
      token: "current-token",
      projectId: "project-1",
    });
    expect(api.authz.hasApiKeyPermission).toHaveBeenCalledWith({
      apiKeyId: "key-1",
      userId: "user-1",
      organizationId: "org-1",
      scope: { type: "project", id: "project-1", teamId: "team-1" },
      permission: "secrets:manage",
    });
    expect(api.calls.create).toHaveBeenCalledWith(
      { projectId: "project-1", name: "OPENAI_API_KEY", value: "secret-value" },
      { id: "user-1" },
    );
    expect(api.apiKeys.markUsed).toHaveBeenCalledExactlyOnceWith({ id: "key-1" });
  });

  /** @scenario "Writes use the authenticated user actor" */
  it("refuses a write from a credential that names no person", async () => {
    const api = await startApi({ userId: null });

    const response = await api.fetch("/api/v1/secret", {
      method: "POST",
      headers: { ...credentials, "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "OPENAI_API_KEY",
        value: "secret-value",
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "authenticated_actor_required",
    });
    expect(api.calls.create).not.toHaveBeenCalled();
  });

  it("still lets that credential read, because a read attributes nothing", async () => {
    const api = await startApi({ userId: null });

    const response = await api.fetch("/api/v1/secret?projectId=project-1", {
      headers: { ...credentials },
    });

    expect(response.status).toBe(200);
    expect(api.calls.list).toHaveBeenCalledWith({ projectId: "project-1" });
  });

  it("does not move the key's last-used clock for a failed REST response", async () => {
    const api = await startApi();

    const response = await api.fetch("/api/secret?projectId=other-project", {
      headers: { ...credentials },
    });

    expect(response.status).toBe(403);
    expect(api.apiKeys.markUsed).not.toHaveBeenCalled();
  });
});

const publicSecret = {
  id: secret.id,
  projectId: secret.projectId,
  name: secret.name,
  createdAt: secret.createdAt.toISOString(),
  updatedAt: secret.updatedAt.toISOString(),
};

async function startApi(caller: { userId?: string | null } = {}) {
  const calls = {
    list: vi.fn(async () => [secret]),
    getValues: vi.fn(async () => ({})),
    get: vi.fn(async () => secret),
    create: vi.fn(async () => secret),
    update: vi.fn(async () => secret),
    delete: vi.fn(async () => undefined),
  };
  const secrets = createApiFixture<SecretApi>(calls, "secrets");
  const apiKeys = apiKeyService();
  const withCallerUser = { ...currentKey, userId: caller.userId ?? null };
  const resolved: ResolvedApiKeyCredential =
    caller.userId === undefined ? currentKey : withCallerUser;
  apiKeys.findResolvedToken.mockResolvedValue(resolved);
  const authz = authzService();
  const managed = ApiHandlerManagedCredentials.create({
    apiKeys: apiKeys.service,
    authz: authz.service,
  });
  const rest = new Hono();
  for (const app of openTestRestDoors({
    services: { secrets: () => secrets },
    ports: { handlerManagedCredential: (input) => managed.authenticate(input) },
  })) {
    rest.route("/", app);
  }
  const application = ApiApplication.create({
    features: new NoApiTrpcFeatures(),
    agents: createApiFixture<AgentApi>(),
    rest,
    http: {
      createContext: async () => ({
        actor: () => ({ id: "user-1" }),
        authorize: async () => undefined,
      }),
    },
  });
  if (!application.hono) {
    throw new Error("HTTP application was not composed.");
  }
  const listener = ApiHttpListener.create({
    application: application.hono,
    host: "127.0.0.1",
    port: 0,
  });
  const address = await listener.start();
  running.push(listener);

  return {
    calls,
    apiKeys,
    authz,
    fetch: (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, init),
  };
}

function apiKeyService() {
  const findResolvedToken = vi.fn<ApiKeyApi["findResolvedToken"]>();
  const markUsed = vi.fn();
  const service = new Proxy({} as ApiKeyApi, {
    get(target, property, receiver) {
      if (property === "findResolvedToken") return findResolvedToken;
      if (property === "markUsed") return markUsed;
      return Reflect.get(target, property, receiver);
    },
  });
  return { service, findResolvedToken, markUsed };
}

function authzService() {
  const hasApiKeyPermission = vi.fn<AuthzService["hasApiKeyPermission"]>().mockResolvedValue(true);
  const service = new Proxy(AuthzService.prototype, {
    get(target, property, receiver) {
      return property === "hasApiKeyPermission"
        ? hasApiKeyPermission
        : Reflect.get(target, property, receiver);
    },
  });
  return { service, hasApiKeyPermission };
}
