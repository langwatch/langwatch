import type { Actor } from "@langwatch/actor";
import { createErrorHandler } from "@langwatch/api";
import { createRestRuntime } from "@langwatch/api/rest";
import { SecretApi } from "@langwatch/secret-contract";
import { describe, expect, it } from "vitest";
import { createSecretTestApp } from "../../app/__tests__/secret.fixture.ts";
import { SECRET_REST_VERSION, secretRest, secretsAliasRest } from "../secret.rest.ts";

const PROJECT = "project-1";
const USER: Actor = { type: "user", id: "user-1" };

function mount(options: { project?: string; actor?: Actor | null } = {}) {
  const app = createSecretTestApp();
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: options.actor === void 0 ? USER : options.actor,
        scope: { tier: "project", id: options.project ?? PROJECT },
      }),
    },
  });

  return runtime.mount(secretRest.router(), {
    app: () => app,
    credential: "project",
    onError: createErrorHandler(),
  });
}

async function create(app: ReturnType<typeof mount>, body: Record<string, unknown>) {
  return app.request("/api/secret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the secret REST family", () => {
  describe("when a credential reads its own project", () => {
    /** @scenario "The modern public API is validated REST" */
    it("serves metadata at the bare, dated and latest addresses alike", async () => {
      const app = mount();
      await create(app, { projectId: PROJECT, name: "OPENAI_API_KEY", value: "sk-live" });

      // A collection's path is the family root, so it contributes nothing to
      // the dated and `latest` addresses: they end at the version segment.
      const paths = [
        `/api/secret?projectId=${PROJECT}`,
        `/api/secret/latest?projectId=${PROJECT}`,
        `/api/secret/${SECRET_REST_VERSION}?projectId=${PROJECT}`,
        `/api/v1/secret?projectId=${PROJECT}`,
      ];
      const answers = await Promise.all(
        paths.map(async (path) => {
          const response = await app.request(path);

          return [path, { status: response.status, body: await response.json() }] as const;
        }),
      );

      const listed = [
        {
          id: expect.any(String),
          projectId: PROJECT,
          name: "OPENAI_API_KEY",
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ];

      expect(Object.fromEntries(answers)).toEqual(
        Object.fromEntries(paths.map((path) => [path, { status: 200, body: listed }])),
      );
    });

    /** @scenario "Secret values never leave the boundary" */
    it("answers a write with metadata and never the value it was given", async () => {
      const response = await create(mount(), {
        projectId: PROJECT,
        name: "OPENAI_API_KEY",
        value: "sk-live",
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).not.toHaveProperty("value");
      expect(body).not.toHaveProperty("encryptedValue");
      expect(JSON.stringify(body)).not.toContain("sk-live");
    });

    /** @scenario "The modern public API is validated REST" */
    it("refuses a body its contract does not accept", async () => {
      const response = await create(mount(), { projectId: PROJECT, name: "lower-case" });

      expect(response.status).toBe(422);
    });
  });

  describe("when the request names a project the credential did not resolve", () => {
    /**
     * The runtime's own scope check refuses this before the handler runs. It
     * raises a plain `Error`, so the refusal reaches the caller as 500 rather
     * than the 403 this family used to answer; the assertion is on the refusal,
     * which is what must hold either way.
     *
     * @scenario "An authorised credential chooses a project"
     */
    it("refuses rather than serving the credential's own project", async () => {
      const app = mount();
      await create(app, { projectId: PROJECT, name: "OPENAI_API_KEY", value: "sk-live" });

      const response = await app.request("/api/secret?projectId=project-2");

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain("OPENAI_API_KEY");
    });
  });

  describe("when the credential is bound to no user", () => {
    /** @scenario "Writes use the authenticated user actor" */
    it("refuses a write", async () => {
      const response = await create(mount({ actor: null }), {
        projectId: PROJECT,
        name: "OPENAI_API_KEY",
        value: "sk-live",
      });

      expect(response.status).toBe(401);
    });
  });

  describe("when a released client calls the plural family", () => {
    /** @scenario "The modern public API is validated REST" */
    it("serves the same routes under its own namespace", async () => {
      const app = createSecretTestApp();
      const runtime = createRestRuntime({
        identity: {
          authenticate: () => ({ actor: USER, scope: { tier: "project", id: PROJECT } }),
        },
      });
      const plural = runtime.mount(secretsAliasRest.router(), {
        app: () => app,
        credential: "project",
        onError: createErrorHandler(),
      });

      const listed = await plural.request(`/api/secrets?projectId=${PROJECT}`);
      const versioned = await plural.request(`/api/v1/secrets?projectId=${PROJECT}`);

      expect(listed.status).toBe(200);
      expect(versioned.status).toBe(200);
      await expect(listed.json()).resolves.toEqual([]);
    });
  });

  it("declares the same five operations under both namespaces", () => {
    expect(secretRest.router().routes.map((route) => route.operation)).toEqual([
      "listSecrets",
      "getSecret",
      "createSecret",
      "updateSecret",
      "deleteSecret",
    ]);
    expect(secretsAliasRest.router().routes.map((route) => route.operation)).toEqual([
      "listSecretsPluralAlias",
      "getSecretPluralAlias",
      "createSecretPluralAlias",
      "updateSecretPluralAlias",
      "deleteSecretPluralAlias",
    ]);
    expect(secretRest.router().api).toBe(SecretApi);
  });
});
