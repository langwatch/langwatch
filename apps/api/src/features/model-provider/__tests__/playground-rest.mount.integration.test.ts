/**
 * `POST /api/playground` through the real Hono app the API process mounts —
 * `runtime.mount` binding the caller, the project, the model and the system
 * prompt as facts off this process's own session read and request headers.
 * The module's own decision logic (`playground.rest.unit.test.ts`) covers the
 * rest; this suite is the wiring only.
 */
// @vitest-environment node
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { ApiPlaygroundRestCollaborators } from "../../../app/api-authoring-rest.composition.ts";
import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountPlaygroundRest } from "../playground-rest.mount.ts";

describe("given the playground's session and header facts", () => {
  describe("when nobody is signed in", () => {
    it("answers 401 without ever probing project permission", async () => {
      const permitted = vi.fn();
      const world = mount({ resolve: async () => null, permitted });

      const response = await world.send({ "x-project-id": "project_1", "x-model": "mp_1/gpt-5-mini" });

      expect(response.status).toBe(401);
      expect(permitted).not.toHaveBeenCalled();
    });
  });

  describe("when a signed-in caller names no project", () => {
    it("answers 400 for the missing header, without probing permission", async () => {
      const permitted = vi.fn();
      const world = mount({ resolve: async () => ({ user: { id: "user_1" } }), permitted });

      const response = await world.send({ "x-model": "mp_1/gpt-5-mini" });

      expect(response.status).toBe(400);
      expect(permitted).not.toHaveBeenCalled();
    });
  });

  describe("when a signed-in caller lacks the project permission", () => {
    it("probes the SAME project id the header named and answers 403", async () => {
      const permitted = vi.fn(async () => false);
      const world = mount({ resolve: async () => ({ user: { id: "user_1" } }), permitted });

      const response = await world.send({ "x-project-id": "project_1", "x-model": "mp_1/gpt-5-mini" });

      expect(permitted).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_1", permission: "playground:view" }),
      );
      expect(response.status).toBe(403);
    });
  });

  describe("when a permitted caller names no model", () => {
    it("answers 400 for the missing header", async () => {
      const world = mount({
        resolve: async () => ({ user: { id: "user_1" } }),
        permitted: async () => true,
      });

      const response = await world.send({ "x-project-id": "project_1" });

      expect(response.status).toBe(400);
    });
  });
});

// ---------------------------------------------------------------------------

function mount(overrides: {
  resolve: ApiPlaygroundRestCollaborators["session"]["resolve"];
  permitted: ApiPlaygroundRestCollaborators["session"]["permitted"];
}) {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const runtime = createApiRestRuntime({
    projectCredential: () => {
      throw new Error("This door resolves no project credential of its own.");
    },
    organizationCredential: () => {
      throw new Error("This door resolves no organization credential of its own.");
    },
    organizationIdentity: () => {
      throw new Error("This door resolves no organization credential of its own.");
    },
    routeAuthorization: () => {
      throw new Error("This suite authorizes no route-scoped permission.");
    },
    errors,
  });

  const modelProviders = { prepareExecution: vi.fn() } as unknown as ModelProviderApi;
  const collaborators: ApiPlaygroundRestCollaborators = {
    session: { resolve: overrides.resolve, permitted: overrides.permitted },
    modelProviders: () => modelProviders,
    executionProxyBaseUrl: "http://nlp.test/go/proxy/v1",
  };
  const mounted = mountPlaygroundRest(runtime, collaborators);
  const hono = new Hono().route("/", mounted);

  return {
    send: (headers: Record<string, string>) =>
      hono.fetch(
        new Request("http://api.test/api/playground", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({ messages: [] }),
        }),
      ),
  };
}
