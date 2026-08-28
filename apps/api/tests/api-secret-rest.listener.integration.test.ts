import { SecretService, type Secret } from "@langwatch/secret-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiApplication } from "../src/api.application";
import { ApiHttpListener } from "../src/api-http.listener";
import { ApiRestSecurityPort } from "../src/api-rest.security";
import { ApiSecretRestFeature } from "../src/api-secret-rest.feature";

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "OPENAI_API_KEY",
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

class TestSecretService extends SecretService {
  readonly list = vi.fn(async () => [secret]);
  readonly getValues = vi.fn(async () => ({}));
  readonly get = vi.fn(async () => secret);
  readonly create = vi.fn(async () => secret);
  readonly update = vi.fn(async () => secret);
  readonly delete = vi.fn(async () => undefined);
}

class TestRestSecurity extends ApiRestSecurityPort {
  readonly authenticate = vi.fn(async () => ({
    projectId: "project-1",
    actor: { id: "user-1" },
  }));
  readonly authorize = vi.fn(async () => undefined);
}

const running: ApiHttpListener[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((listener) => listener.close()));
});

describe("standalone Secret REST listener", () => {
  it("serves every deployed collection and item operation through each Secret base path", async () => {
    const api = await startApi();
    const bases = ["/api/v1/secret", "/api/v1/secrets", "/api/secret", "/api/secrets"];

    for (const base of bases) {
      const collection = await api.fetch(`${base}?projectId=project-1`);
      const create = await api.fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          name: "OPENAI_API_KEY",
          value: "secret-value",
        }),
      });
      const item = await api.fetch(`${base}/secret-1?projectId=project-1`);
      const update = await api.fetch(`${base}/secret-1`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project-1",
          value: "replacement-secret-value",
        }),
      });
      const remove = await api.fetch(`${base}/secret-1`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
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

    expect(api.secrets.list).toHaveBeenCalledTimes(bases.length);
    expect(api.secrets.get).toHaveBeenCalledTimes(bases.length);
    expect(api.secrets.create).toHaveBeenCalledTimes(bases.length);
    expect(api.secrets.update).toHaveBeenCalledTimes(bases.length);
    expect(api.secrets.delete).toHaveBeenCalledTimes(bases.length);
    expect(api.security.authorize).toHaveBeenCalledTimes(bases.length * 5);
  });

  it("selects v1 from the path or header and refuses unsupported or conflicting versions", async () => {
    const api = await startApi();
    const explicit = await api.fetch("/api/v1/secret?projectId=project-1", {
      headers: { "X-API-Version": "v1" },
    });
    const latest = await api.fetch("/api/secret?projectId=project-1");
    const selected = await api.fetch("/api/secrets?projectId=project-1", {
      headers: { "X-API-Version": "v1" },
    });
    const unsupported = await api.fetch("/api/secret?projectId=project-1", {
      headers: { "X-API-Version": "v2" },
    });
    const conflict = await api.fetch("/api/v1/secrets?projectId=project-1", {
      headers: { "X-API-Version": "v2" },
    });
    const wrongProject = await api.fetch("/api/secret?projectId=project-2");

    expect(explicit.headers.get("X-API-Version-Status")).toBe("stable");
    expect(explicit.headers.get("X-API-Version")).toBe("v1");
    expect(latest.headers.get("X-API-Version-Status")).toBe("latest");
    expect(latest.headers.get("X-API-Version")).toBe("v1");
    expect(selected.headers.get("X-API-Version-Status")).toBe("stable");
    expect(selected.headers.get("X-API-Version")).toBe("v1");
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({ code: "invalid_api_version" });
    expect(conflict.status).toBe(400);
    await expect(conflict.json()).resolves.toMatchObject({ code: "api_version_conflict" });
    expect(wrongProject.status).toBe(403);
    await expect(wrongProject.json()).resolves.toMatchObject({ code: "project_input_mismatch" });
  });

  it("uses the process REST security policy and actor for a write", async () => {
    const api = await startApi();
    const response = await api.fetch("/api/v1/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "OPENAI_API_KEY",
        value: "secret-value",
      }),
    });

    expect(response.status).toBe(201);
    expect(api.security.authenticate).toHaveBeenCalledOnce();
    expect(api.security.authorize).toHaveBeenCalledWith({
      request: { projectId: "project-1", actor: { id: "user-1" } },
      permission: "secrets:manage",
    });
    expect(api.secrets.create).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "OPENAI_API_KEY",
      value: "secret-value",
      actorId: "user-1",
    });
  });
});

const publicSecret = {
  id: secret.id,
  projectId: secret.projectId,
  name: secret.name,
  createdAt: secret.createdAt.toISOString(),
  updatedAt: secret.updatedAt.toISOString(),
};

async function startApi() {
  const secrets = new TestSecretService();
  const security = new TestRestSecurity();
  const application = ApiApplication.create({
    secrets,
    rest: ApiSecretRestFeature.create({ secrets, security }),
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
    secrets,
    security,
    fetch: (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, init),
  };
}
