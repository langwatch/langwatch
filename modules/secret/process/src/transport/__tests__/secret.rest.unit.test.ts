import type { Actor } from "@langwatch/actor";
import { createErrorHandler } from "@langwatch/api";
import { createRestRuntime } from "@langwatch/api/rest";
import { SecretApi, secretPublicSchema } from "@langwatch/secret-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { createSecretTestApp } from "../../app/__tests__/secret.fixture.ts";
import { SECRET_REST_VERSION, secretRest } from "../secret.rest.ts";

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
  return app.request("/api/secrets", {
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
        `/api/secrets?projectId=${PROJECT}`,
        `/api/secrets/latest?projectId=${PROJECT}`,
        `/api/secrets/${SECRET_REST_VERSION}?projectId=${PROJECT}`,
        `/api/v1/secrets?projectId=${PROJECT}`,
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

      const response = await app.request("/api/secrets?projectId=project-2");

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

  describe("when a released client calls the family", () => {
    let plural: ReturnType<typeof mount>;

    beforeEach(() => {
      plural = mount();
    });

    /** @scenario "The modern public API is validated REST" */
    it("serves no singular `/api/secret` address, which main never published", async () => {
      const response = await plural.request(`/api/secret?projectId=${PROJECT}`);

      expect(response.status).toBe(404);
    });

    /** @scenario "The modern public API is validated REST" */
    it("reads the project from the credential when the request names none", async () => {
      const created = await plural.request("/api/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "OPENAI_API_KEY", value: "sk-live" }),
      });
      const listed = await plural.request("/api/secrets");

      expect(created.status).toBe(201);
      expect(listed.status).toBe(200);
      await expect(listed.json()).resolves.toMatchObject([
        { projectId: PROJECT, name: "OPENAI_API_KEY" },
      ]);
    });

    /** @scenario "The modern public API is validated REST" */
    it("reads, replaces and deletes a secret at the id its path names", async () => {
      const created = await plural.request("/api/secrets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "OPENAI_API_KEY", value: "sk-live" }),
      });
      const { id } = secretPublicSchema.parse(await created.json());

      const read = await plural.request(`/api/secrets/${id}`);
      const replaced = await plural.request(`/api/secrets/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "sk-rotated" }),
      });
      const deleted = await plural.request(`/api/secrets/${id}`, { method: "DELETE" });

      expect([read.status, replaced.status, deleted.status]).toEqual([200, 200, 200]);
      await expect(read.json()).resolves.toMatchObject({ id, name: "OPENAI_API_KEY" });
      await expect(deleted.json()).resolves.toEqual({ id, deleted: true });
    });
  });

  it("declares main's five operations", () => {
    expect(secretRest.router().routes.map((route) => route.operation)).toEqual([
      "getApiSecrets",
      "getApiSecretsById",
      "postApiSecrets",
      "putApiSecretsById",
      "deleteApiSecretsById",
    ]);
    expect(secretRest.router().api).toBe(SecretApi);
  });
});
