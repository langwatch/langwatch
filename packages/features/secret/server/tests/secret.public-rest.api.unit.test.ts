import { createRestService } from "@langwatch/api/rest";
import { SecretService, type Secret } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";
import { SECRET_PUBLIC_API_VERSION, SecretPublicRestApi } from "../src/api/public-rest/secret.api";

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

  getValues(): Promise<Record<string, string>> {
    return Promise.resolve({});
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
  const rest = createRestService<typeof runtimeApp>({
    name: "secret",
    app: () => runtimeApp,
    actor: () => ({ id: "user-1" }),
    logger: false,
    maxInputBytes: 16 * 1024,
    permissionEnforcer: () => async (_context, next) => next(),
    tracer: false,
  })
    .withoutRateLimit("unit test has no rate limiter")
    .withoutResourceLimit("unit test has no resource limiter");
  return SecretPublicRestApi.create().install(rest).build();
}

describe("SecretPublicRestApi", () => {
  /** @scenario "The modern public API is validated REST" */
  it("serves metadata at the direct collection root", async () => {
    const app = buildApi();
    const collection = await app.request("/api/v1/secret?projectId=project-1");
    const header = await app.request("/api/v1/secret?projectId=project-1", {
      headers: { "X-API-Version": SECRET_PUBLIC_API_VERSION },
    });

    expect(collection.status).toBe(200);
    expect(header.status).toBe(200);
    await expect(header.json()).resolves.toEqual([
      {
        id: "secret-1",
        projectId: "project-1",
        name: "OPENAI_API_KEY",
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    ]);
  });

  it("takes writes from JSON and validates output before sending it", async () => {
    const response = await buildApi().request("/api/v1/secret", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-1",
        name: "OPENAI_API_KEY",
        value: "secret-value",
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: "secret-1",
      projectId: "project-1",
      name: "OPENAI_API_KEY",
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    });
  });

  it("does not mount compatibility routes on the isolated modern REST app", async () => {
    const app = buildApi();
    const legacyRest = await app.request("/api/secrets");
    const legacyRpc = await app.request("/api/secrets/latest/secrets.list", {
      method: "POST",
    });

    expect(legacyRest.status).toBe(404);
    expect(legacyRpc.status).toBe(404);
  });
});
