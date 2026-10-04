import {
  bindRestMiddleware,
  createRestRuntime,
  type IdempotentRunner,
  type RestErrorHandler,
} from "@langwatch/api/rest";
/**
 * The four provider-binding addresses answer 410 on the in-memory runtime.
 * Mounted rather than called directly, because the fact under test is what a
 * caller still on the old address receives, not what the handler throws.
 */
import type {
  GatewayApi,
  GatewayKeyCaller,
  GatewayRequestCredential,
} from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  gatewayKeyCaller,
  gatewayVirtualKeyCaller,
  gatewayPlatformRest,
  gatewayRestCredential,
} from "../gateway-platform.rest.ts";

const PROJECT_ID = "project-1";

/** Honours the error's own status, so a 410 arrives as a 410. */
const renderError: RestErrorHandler = (error, context) => {
  if (HandledError.isHandled(error)) {
    return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
      status: error.httpStatus,
      headers: { "content-type": "application/json" },
    });
  }

  return context.json({ error: { code: "internal_server_error" } }, 500);
};

/** Runs the create and stores nothing; enough to satisfy the mount. */
const runOnce: IdempotentRunner = async ({ handler }) => {
  const response = await handler();

  return { isReplayed: false, status: response.status, response };
};

const projectDoor = () => ({
  actor: { type: "api_key" as const, id: "api-key-1" },
  scope: { tier: "project" as const, id: PROJECT_ID },
});

const keyDoor = () => ({
  actor: { type: "user" as const, id: "user-1" },
  scope: { tier: "organization" as const, id: "organization-1" },
});

/** The tombstones reach no operation, so the fixture needs no members. */
function mountedPlatform() {
  const app = createApiFixture<GatewayApi>({});
  const runtime = createRestRuntime({
    // Unrelated creates on this family declare themselves replayable, so the
    // whole family refuses to mount without the port. It runs and keeps no
    // receipt: no test here replays anything.
    idempotency: runOnce,
    identity: { authenticate: projectDoor, identify: projectDoor },
    doors: { api_key: { authenticate: keyDoor, identify: keyDoor } },
  });

  return runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError: renderError,
    facts: [
      bindRestMiddleware(gatewayKeyCaller, (): GatewayKeyCaller => ({
        kind: "project",
        projectId: PROJECT_ID,
      })),
      bindRestMiddleware(gatewayVirtualKeyCaller, (): GatewayKeyCaller => ({
        kind: "project",
        projectId: PROJECT_ID,
      })),
      bindRestMiddleware(gatewayRestCredential, (): GatewayRequestCredential => ({
        kind: "legacyProjectKey",
      })),
    ],
  });
}

const RETIRED = [
  { method: "GET", path: "/api/gateway/v1/providers" },
  { method: "POST", path: "/api/gateway/v1/providers" },
  { method: "PATCH", path: "/api/gateway/v1/providers/pc_1" },
  { method: "DELETE", path: "/api/gateway/v1/providers/pc_1" },
] as const;

describe("given the published gateway management surface", () => {
  describe("when a caller uses a retired provider-binding address", () => {
    /** @scenario "A caller on a retired provider-binding address is told where it went" */
    it("answers gone on all four addresses, not not-found", async () => {
      const hono = mountedPlatform();

      for (const { method, path } of RETIRED) {
        const response = await hono.request(path, {
          method,
          headers: { "content-type": "application/json" },
          ...(method === "GET" || method === "DELETE" ? {} : { body: "{}" }),
        });

        expect({ method, path, status: response.status }).toEqual({ method, path, status: 410 });
        await expect(response.json()).resolves.toMatchObject({
          error: { code: "gateway_provider_bindings_gone" },
        });
      }
    });

    /** @scenario "A caller on a retired provider-binding address is told where it went" */
    it("names the model-provider address that replaced the binding", async () => {
      const response = await mountedPlatform().request("/api/gateway/v1/providers");
      const body = (await response.json()) as { error: { message: string } };

      expect(body.error.message).toContain("/api/gateway/v1/model-providers");
    });
  });

  describe("when the surface is read as a declaration", () => {
    /** @scenario "Every retired address stays published rather than disappearing" */
    it("still declares all four provider-binding operations", () => {
      const declared = gatewayPlatformRest
        .router()
        .routes.filter((route) => route.path.startsWith("/providers"))
        .map((route) => `${route.method} ${route.path}`)
        .toSorted();

      expect(declared).toEqual([
        "delete /providers/:id",
        "get /providers",
        "patch /providers/:id",
        "post /providers",
      ]);
    });
  });
});
