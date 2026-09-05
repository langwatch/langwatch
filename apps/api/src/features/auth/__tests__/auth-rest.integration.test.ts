/**
 * The `/api/auth` family's membership in this process's REST app, driven through the real
 * Hono app `createApiProcessRestFeatures` returns. Membership is the whole subject.
 * Spec: specs/auth/auth-rest-family-mounted.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { AuthCliDeviceFlowRestPorts } from "@langwatch/auth-server";
import { Hono, type ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";
import { composeApiAuthRest } from "../auth-rest.mount";

const BASE_URL = "https://app.test";

describe("given a process that composed its own Better Auth instance", () => {
  describe("when the browser reads the session endpoint", () => {
    /** @scenario "The browser can read who is signed in" */
    it("is answered by the session route rather than a 404", async () => {
      const world = authWorld();
      const api = mount(world);

      const response = await api.get("/api/auth/session");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        user: { id: "user-1", email: "bob@example.com" },
      });
      // The session route answered, not the catch-all standing behind it.
      expect(world.handler).not.toHaveBeenCalled();
    });
  });

  describe("when a sign-in call arrives from the deployment's own origin", () => {
    /** @scenario "The Better Auth catch-all serves the sign-in call" */
    it("is handled by the Better Auth instance this process composed", async () => {
      const world = authWorld();
      const api = mount(world);

      const response = await api.post("/api/auth/sign-in/email", { origin: BASE_URL });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ handledByBetterAuth: true });
      expect(world.handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the CLI asks for a device code", () => {
    /** @scenario "The CLI device grant still reaches its own routes" */
    it("is answered by the device grant rather than the Better Auth catch-all", async () => {
      const world = authWorld();
      const startDeviceCode = vi.fn(() =>
        Promise.resolve({ device_code: "device-1", user_code: "WXYZ-1234" }),
      );
      const api = mount(world, deviceGrantClaiming(startDeviceCode));

      const response = await api.post("/api/auth/cli/device-code", { origin: BASE_URL });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ device_code: "device-1" });
      expect(startDeviceCode).toHaveBeenCalledTimes(1);
      // The catch-all is registered after the grant, so it never saw the call.
      expect(world.handler).not.toHaveBeenCalled();
    });
  });
});

describe("given a process that composed no Better Auth instance of its own", () => {
  describe("when the browser reads the session endpoint", () => {
    /** @scenario "A process handed someone else's transport mounts no auth door" */
    it("mounts no auth family, rather than answering signed out on a guess", () => {
      const world = authWorld();
      const ports = composeApiAuthRest({
        betterAuth: undefined,
        sessions: world.sessions,
        auth: world.auth,
        apiKeys: world.apiKeys,
        prisma: world.prisma,
        featureFlags: world.featureFlags,
      });

      expect(ports).toBeUndefined();
    });
  });
});

function authWorld() {
  const handler = vi.fn(
    async (_request: Request) =>
      new Response(JSON.stringify({ handledByBetterAuth: true }), {
        headers: { "content-type": "application/json" },
      }),
  );
  const sessions = {
    tryResolveVerifiedSession: () =>
      Promise.resolve({
        session: { id: "session-1", expiresAt: new Date("2026-10-01T00:00:00.000Z") },
        user: { id: "user-1", email: "bob@example.com" },
      }),
  };
  const auth = {
    tryResolveBrowserSession: () =>
      Promise.resolve({
        user: { id: "user-1", name: "Bob", email: "bob@example.com", image: null },
        expires: "2026-10-01T00:00:00.000Z",
        sessionId: "session-1",
      }),
    revokeBrowserSession: vi.fn(() => Promise.resolve()),
  };
  const apiKeys = {
    tryResolveToken: () =>
      Promise.resolve({ type: "legacyProjectKey" as const, project: { slug: "acme" } }),
  };
  const featureFlags = { isEnabled: () => Promise.resolve(false) };
  const prisma = {};

  return {
    handler,
    sessions: sessions as never,
    auth: auth as never,
    apiKeys: apiKeys as never,
    prisma: prisma as never,
    featureFlags: featureFlags as never,
    betterAuth: {
      transport: { handler, api: { getSession: async (_input: { headers: Headers }) => null } },
      baseUrl: BASE_URL,
    },
  };
}

/** A device grant whose only reached operation is the one under test. */
function deviceGrantClaiming(startDeviceCode: () => Promise<unknown>): AuthCliDeviceFlowRestPorts {
  return {
    sessions: { startDeviceCode },
    database: () => ({}),
    session: () => Promise.resolve(null),
    apiKeys: () => ({}),
    ensurePersonalWorkspace: () => Promise.resolve({}),
    canWriteProject: () => Promise.resolve(false),
    featureFlags: () => ({ isEnabled: () => Promise.resolve(true) }),
  } as never;
}

function mount(
  world: ReturnType<typeof authWorld>,
  deviceFlow?: AuthCliDeviceFlowRestPorts,
): {
  get: (path: string) => Promise<Response>;
  post: (path: string, options: { origin: string }) => Promise<Response>;
} {
  const auth = composeApiAuthRest({
    betterAuth: world.betterAuth,
    sessions: world.sessions,
    auth: world.auth,
    apiKeys: world.apiKeys,
    prisma: world.prisma,
    featureFlags: world.featureFlags,
  });
  if (!auth) throw new Error("The auth family must compose when the instance is composed.");

  const hono = new Hono();
  for (const app of createApiProcessRestFeatures({
    security: passThroughSecurity(),
    ports: {
      handlerManagedCredential: () => {
        throw new Error("the auth family resolves its own credential.");
      },
      rateLimit: async () => ({ allowed: true }),
      ...(deviceFlow ? { authCliDeviceFlow: deviceFlow } : {}),
      auth,
    },
  })) {
    hono.route("/", app);
  }

  const fetchAt = async (path: string, init?: RequestInit): Promise<Response> =>
    await hono.fetch(new Request(`http://api.test${path}`, init));

  return {
    get: (path) => fetchAt(path),
    post: (path, options) =>
      fetchAt(path, {
        method: "POST",
        headers: { "content-type": "application/json", origin: options.origin },
        body: JSON.stringify({}),
      }),
  };
}

/** A failure here must be legible rather than swallowed into a generic 500. */
const renderUnexpected: ErrorHandler = (error, c) => c.json({ error: String(error) }, 500);

function passThroughSecurity(): AppRestSecurity {
  const noop = async (_c: unknown, next: () => Promise<void>) => {
    await next();
  };
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderUnexpected,
    canonicalErrorHandler: renderUnexpected,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}
