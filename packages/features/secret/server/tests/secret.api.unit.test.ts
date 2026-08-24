import { createService } from "@langwatch/api";
import { SecretService, type Secret } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";
import { SecretPublicApi } from "../src/api/public/secret.api";

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "OPENAI_API_KEY",
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

class StubSecretService extends SecretService {
  list(): Promise<Secret[]> {
    return Promise.resolve([secret]);
  }
  get(): Promise<Secret> {
    return Promise.resolve(secret);
  }
  create(): Promise<Secret> {
    return Promise.resolve(secret);
  }
  update(): Promise<Secret> {
    return Promise.resolve(secret);
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

function buildApi() {
  const runtimeApp = { secrets: new StubSecretService() };
  const builder = createService<unknown, typeof runtimeApp>({
    name: "secrets",
    basePath: "/api/secrets",
    app: () => runtimeApp,
    permissionEnforcer: () => async (_context, next) => next(),
  });
  return SecretPublicApi.create()
    .install(builder)
    .build();
}

describe("SecretPublicApi", () => {
  it("mounts the modern RPC at a dated and latest URL", async () => {
    const app = buildApi();
    const dated = await app.request(
      "/api/secrets/2026-08-24/secrets.list",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-1" }),
      },
    );
    const latest = await app.request("/api/secrets/latest/secrets.list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-1" }),
    });

    expect(dated.status).toBe(200);
    expect(latest.status).toBe(200);
    await expect(latest.json()).resolves.toEqual([
      {
        id: "secret-1",
        projectId: "project-1",
        name: "OPENAI_API_KEY",
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    ]);
  });

  it("does not accept the old REST spelling on the RPC app", async () => {
    const response = await buildApi().request("/api/secrets", {
      method: "GET",
    });
    expect(response.status).toBe(404);
  });
});
