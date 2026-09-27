/**
 * @vitest-environment node
 * The `/api/auth` family over the real declaration and REST runtime.
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import { ProjectInvalidCredentialsError, ProjectMissingCredentialsError } from "@langwatch/api";
import { BearerIdentity, RestHost } from "@langwatch/api/rest";
import { describe, expect, it, vi } from "vitest";

import type { AuthSessionPoll } from "../../rules/auth-session-poll.rules.ts";
import { authRest, type AuthDoorApi } from "../auth.rest.ts";

const BASE_URL = "https://app.test";

const SIGNED_IN: AuthSessionPoll = {
  document: {
    session: { expiresAt: "2026-01-01T00:00:00.000Z" },
    user: { id: "user-1", email: "bob@example.com", name: "Bob", image: null },
  },
};

function authWorld(overrides: Partial<AuthDoorApi> = {}) {
  const betterAuthHandshake = vi.fn<(request: Request) => Promise<Response>>(async () =>
    Response.json({ handledByBetterAuth: true }),
  );
  const revokeSessionFromCookies = vi.fn<(input: { cookie: string | undefined }) => Promise<void>>(
    async () => {},
  );
  const door: AuthDoorApi = {
    validateProjectAuthToken: async () => ({ projectSlug: "acme" }),
    getSessionByCookie: async () => SIGNED_IN,
    revokeSessionFromCookies,
    betterAuthHandshake,
    baseUrl: () => BASE_URL,
    federatedLogout: async () => null,
    ...overrides,
  };
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  const host = RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      apiKey: closed,
      scimToken: closed,
      "instance-admin": closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  });
  host.mount(authRest.router(), () => door);

  return { app: host.app, betterAuthHandshake, revokeSessionFromCookies };
}

describe("given the /api/auth family mounted on a process's own doors", () => {
  describe("when the browser reads the session endpoint", () => {
    it("answers the session document, never cached, rather than falling through to the catch-all", async () => {
      const getSessionByCookie = vi.fn<AuthDoorApi["getSessionByCookie"]>(async () => SIGNED_IN);
      const world = authWorld({ getSessionByCookie });

      const response = await world.app.request(`${BASE_URL}/api/auth/session`, {
        headers: { cookie: "better-auth.session_token=abc" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store, must-revalidate");
      await expect(response.json()).resolves.toEqual(SIGNED_IN.document);
      expect(getSessionByCookie).toHaveBeenCalledWith({ cookie: "better-auth.session_token=abc" });
      expect(world.betterAuthHandshake).not.toHaveBeenCalled();
    });

    it("answers a bare null for a request carrying no session", async () => {
      const world = authWorld({ getSessionByCookie: async () => ({ document: null }) });

      const response = await world.app.request(`${BASE_URL}/api/auth/session`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toBeNull();
    });
  });

  describe("when a legacy client presents a project token", () => {
    it("names the project it belongs to, counted against the caller's nearest hop", async () => {
      const validateProjectAuthToken = vi.fn<AuthDoorApi["validateProjectAuthToken"]>(async () => ({
        projectSlug: "acme",
      }));
      const world = authWorld({ validateProjectAuthToken });

      const response = await world.app.request(`${BASE_URL}/api/auth/validate`, {
        method: "POST",
        headers: { "x-auth-token": "tok", "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ projectSlug: "acme" });
      expect(validateProjectAuthToken).toHaveBeenCalledWith({
        token: "tok",
        forwardedFor: "1.1.1.1, 2.2.2.2",
      });
    });

    it("takes the empty JSON body the Python SDK's login sends", async () => {
      const world = authWorld();

      const response = await world.app.request(`${BASE_URL}/api/auth/validate`, {
        method: "POST",
        headers: { "x-auth-token": "tok", "content-type": "application/json" },
        body: "{}",
      });

      expect(response.status).toBe(200);
    });

    it("refuses a request carrying no token at all with the handled 401", async () => {
      const world = authWorld({
        validateProjectAuthToken: async () => {
          throw new ProjectMissingCredentialsError();
        },
      });

      const response = await world.app.request(`${BASE_URL}/api/auth/validate`, { method: "POST" });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "missing_credentials" });
    });

    it("refuses a token that names no project with the handled 401", async () => {
      const world = authWorld({
        validateProjectAuthToken: async () => {
          throw new ProjectInvalidCredentialsError();
        },
      });

      const response = await world.app.request(`${BASE_URL}/api/auth/validate`, {
        method: "POST",
        headers: { "x-auth-token": "tok" },
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({ code: "invalid_credentials" });
    });
  });

  describe("when the browser signs out", () => {
    it("revokes the session its cookies name and expires every cookie in both spellings", async () => {
      const world = authWorld();

      const response = await world.app.request(`${BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: { cookie: "better-auth.session_token=abc" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });
      expect(world.revokeSessionFromCookies).toHaveBeenCalledWith({
        cookie: "better-auth.session_token=abc",
      });
      expect(response.headers.getSetCookie()).toHaveLength(6);
    });

    it("sends a GET sign-out to the local sign-in page where no federation answers", async () => {
      const world = authWorld();

      const response = await world.app.request(`${BASE_URL}/api/auth/logout`, {
        headers: { cookie: "better-auth.session_token=abc" },
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/auth/signin");
    });

    it("follows the federated target where the deployment resolves one", async () => {
      const world = authWorld({ federatedLogout: async () => "https://idp.test/logout" });

      const response = await world.app.request(`${BASE_URL}/api/auth/logout`);

      expect(response.headers.get("location")).toBe("https://idp.test/logout");
    });
  });

  describe("when a sign-in call reaches the catch-all", () => {
    it("is answered by the Better Auth handshake this process composed", async () => {
      const world = authWorld();

      const response = await world.app.request(`${BASE_URL}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin: BASE_URL },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ handledByBetterAuth: true });
      expect(world.betterAuthHandshake).toHaveBeenCalledTimes(1);
    });
  });
});
