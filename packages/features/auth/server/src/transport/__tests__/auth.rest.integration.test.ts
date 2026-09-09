/**
 * @vitest-environment node
 * The `/api/auth` family over the real declaration and REST runtime.
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import { createRestRuntime } from "@langwatch/api/rest";
import { describe, expect, it, vi } from "vitest";

import { authRest, type AuthDoorApi, type AuthRestSession } from "../auth.rest.ts";

const BASE_URL = "https://app.test";

const SIGNED_IN: AuthRestSession = {
  expires: "2026-01-01T00:00:00.000Z",
  user: { id: "user-1", email: "bob@example.com", name: "Bob", image: null },
};

function authWorld(overrides: Partial<AuthDoorApi> = {}) {
  const handler = vi.fn<(request: Request) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify({ handledByBetterAuth: true }), {
        headers: { "content-type": "application/json" },
      }),
  );
  const getSession = vi.fn<() => Promise<{ session: { id: string } }>>(async () => ({
    session: { id: "session-1" },
  }));
  const revokeBrowserSession = vi.fn<(input: { sessionId: string }) => Promise<void>>(
    async () => {},
  );
  const door: AuthDoorApi = {
    betterAuth: () => ({ handler, api: { getSession } }),
    revokeBrowserSession,
    resolveSession: async () => SIGNED_IN,
    findProjectSlugByToken: async () => null,
    featureFlags: () => ({ isEnabled: async () => false }) as never,
    directory: () => ({}) as never,
    baseUrl: BASE_URL,
    federatedLogout: async () => null,
    runWithIdentityBirth: (run) => run(),
    ...overrides,
  };
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("This family resolves its own credential.");
      },
    },
  });
  const app = runtime.mount(authRest.router(), {
    app: () => door,
    credential: "public",
    onError: (error, context) => context.json({ error: String(error) }, 500),
  });

  return { app, handler, getSession, revokeBrowserSession };
}

describe("given the /api/auth family mounted on a process's own doors", () => {
  describe("when the browser reads the session endpoint", () => {
    it("answers the session rather than falling through to the catch-all", async () => {
      const world = authWorld();

      const response = await world.app.request("/api/auth/session");

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
      await expect(response.json()).resolves.toEqual({
        session: { expiresAt: SIGNED_IN.expires },
        user: {
          id: "user-1",
          name: "Bob",
          email: "bob@example.com",
          image: null,
        },
      });
      expect(world.handler).not.toHaveBeenCalled();
    });

    it("answers a bare null for a request carrying no session", async () => {
      const world = authWorld({ resolveSession: async () => null });

      const response = await world.app.request("/api/auth/session");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toBeNull();
    });
  });

  describe("when a legacy client presents a project token", () => {
    it("names the project it belongs to", async () => {
      const world = authWorld({ findProjectSlugByToken: async () => "acme" });

      const response = await world.app.request("/api/auth/validate", {
        method: "POST",
        headers: { "x-auth-token": "tok" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ projectSlug: "acme" });
    });

    it("refuses a request carrying no token at all, in the sentence it always has", async () => {
      const world = authWorld();

      const response = await world.app.request("/api/auth/validate", { method: "POST" });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        message: "X-Auth-Token header is required.",
      });
    });

    it("refuses a token that names no project", async () => {
      const world = authWorld();

      const response = await world.app.request("/api/auth/validate", {
        method: "POST",
        headers: { "x-auth-token": "tok" },
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ message: "Invalid auth token." });
    });
  });

  describe("when the browser signs out", () => {
    it("revokes the session and expires every cookie in both spellings", async () => {
      const world = authWorld();

      const response = await world.app.request("/api/auth/logout", {
        method: "POST",
        headers: { cookie: "better-auth.session_token=abc" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(world.revokeBrowserSession).toHaveBeenCalledWith({ sessionId: "session-1" });
      expect(response.headers.getSetCookie()).toHaveLength(6);
    });

    it("still clears the cookies when the session lookup fails", async () => {
      const world = authWorld();

      world.getSession.mockRejectedValueOnce(new Error("store down"));

      const response = await world.app.request("/api/auth/logout", {
        method: "POST",
        headers: { cookie: "better-auth.session_token=abc" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toHaveLength(6);
    });

    it("sends a GET sign-out to the local sign-in page where no federation answers", async () => {
      const world = authWorld();

      const response = await world.app.request("/api/auth/logout", {
        headers: { cookie: "better-auth.session_token=abc" },
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/auth/signin");
    });

    it("follows the federated target where the deployment resolves one", async () => {
      const world = authWorld({ federatedLogout: async () => "https://idp.test/logout" });

      const response = await world.app.request("/api/auth/logout");

      expect(response.headers.get("location")).toBe("https://idp.test/logout");
    });
  });

  describe("when a sign-in call reaches the catch-all", () => {
    it("is handled by the Better Auth instance this process composed", async () => {
      const world = authWorld();

      const response = await world.app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: BASE_URL },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ handledByBetterAuth: true });
      expect(world.handler).toHaveBeenCalledTimes(1);
    });

    it("refuses a state-changing call from another origin, and never reaches Better Auth", async () => {
      const world = authWorld();

      const response = await world.app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        message: "Invalid origin",
        code: "INVALID_ORIGIN",
      });
      expect(world.handler).not.toHaveBeenCalled();
    });

    it("lets a read through whatever origin it names, so a callback still lands", async () => {
      const world = authWorld();

      const response = await world.app.request("/api/auth/callback/oidc");

      expect(response.status).toBe(200);
      expect(world.handler).toHaveBeenCalledTimes(1);
    });
  });
});
