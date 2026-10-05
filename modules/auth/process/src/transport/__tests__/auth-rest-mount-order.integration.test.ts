/**
 * @vitest-environment node
 * The `/api/auth` family mounted before a later `/api/auth/cli/*` family, in install order.
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import { publicRoute } from "@langwatch/api/access";
import {
  BearerIdentity,
  MANAGEMENT_API_VERSION,
  defineRestRouter,
  RestHost,
} from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authRest, type AuthDoorApi } from "../auth.rest.ts";

const BASE_URL = "https://app.test";

type CliPlane = {
  bootstrap(): { plane: string };
  projectKey(): { plane: string };
  deviceCode(): { plane: string };
};

const CliPlaneApi = moduleApi<CliPlane>()("governance");

const CLI_PLANE_DOOR = publicRoute({
  reason: "a later family's CLI routes, in a mount-order fixture",
});

const cliPlaneRest = defineRestRouter(CliPlaneApi)
  .withNamespace("governance-cli")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .get("/api/auth/cli/bootstrap", "readCliBootstrap")
  .withAccess(CLI_PLANE_DOOR)
  .withOutput(z.object({ plane: z.string() }))
  .handle(({ app }) => app.bootstrap())
  .post("/api/auth/cli/device-code", "startCliDeviceCode")
  .withAccess(CLI_PLANE_DOOR)
  .withOutput(z.object({ plane: z.string() }))
  .handle(({ app }) => app.deviceCode())
  .post("/api/auth/cli/project-key", "readCliProjectKey")
  .withAccess(CLI_PLANE_DOOR)
  .withOutput(z.object({ plane: z.string() }))
  .handle(({ app }) => app.projectKey())
  .build();

function mountedInInstallOrder() {
  const handler = vi.fn<(request: Request) => Promise<Response>>(
    async () => new Response(null, { status: 404 }),
  );
  const door: AuthDoorApi = {
    validateProjectAuthToken: async () => ({ projectSlug: "unreached" }),
    getSessionByCookie: async () => ({ document: null }),
    revokeSessionFromCookies: async () => {},
    betterAuthHandshake: handler,
    baseUrl: () => BASE_URL,
    federatedLogout: async () => null,
  };
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  host.mount(authRest.router(), () => door);
  host.mount(cliPlaneRest.router(), () => ({
    bootstrap: () => ({ plane: "bootstrap" }),
    projectKey: () => ({ plane: "project-key" }),
    deviceCode: () => ({ plane: "device-code" }),
  }));

  return { app: host.app, handler };
}

describe("given the /api/auth family mounted before a later family serving /api/auth/cli/*", () => {
  describe("when a CLI reads a route the later family declares", () => {
    /** @scenario "The CLI governance routes mounted after the auth family still reach their own routes" */
    it("answers from that family rather than Better Auth's catch-all", async () => {
      const world = mountedInInstallOrder();

      const response = await world.app.request(`${BASE_URL}/api/auth/cli/bootstrap`, {
        headers: { authorization: "Bearer lw_at_live" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ plane: "bootstrap" });
      expect(world.handler).not.toHaveBeenCalled();
    });
  });

  describe("when the CLI asks for a device code", () => {
    /** @scenario "The CLI device grant still reaches its own routes" */
    it("answers from the device grant rather than Better Auth's catch-all", async () => {
      const world = mountedInInstallOrder();

      const response = await world.app.request(`${BASE_URL}/api/auth/cli/device-code`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ plane: "device-code" });
      expect(world.handler).not.toHaveBeenCalled();
    });
  });

  describe("when a CLI posts to a route the later family declares, with no browser origin", () => {
    it("is not refused by the sign-in door's origin gate", async () => {
      const world = mountedInInstallOrder();

      const response = await world.app.request(`${BASE_URL}/api/auth/cli/project-key`, {
        method: "POST",
        headers: { authorization: "Bearer lw_at_live", "content-type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ plane: "project-key" });
    });
  });

  describe("when a sign-in call arrives beside them", () => {
    it("still reaches Better Auth", async () => {
      const world = mountedInInstallOrder();

      await world.app.request(`${BASE_URL}/api/auth/get-session`);

      expect(world.handler).toHaveBeenCalledOnce();
    });
  });
});
