/**
 * @vitest-environment node
 * The `/api/auth` door: Better Auth's handshake, the browser's session poll and sign-out.
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import { ClientAddress } from "@langwatch/api/policy";
import type {
  BrowserSessionResolution,
  BrowserSessionVerification,
} from "@langwatch/auth-contract";
import type * as observabilityModule from "@langwatch/observability";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { AuthDoorService, type AuthDoorDeps } from "../auth-door.service.ts";

const loggerSpies = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => loggerSpies,
}));

const BASE_URL = "https://app.test";
const SESSION_COOKIE = "better-auth.session_token=abc.sig";

const VERIFIED: BrowserSessionVerification = {
  kind: "verified",
  verified: {
    session: { id: "session-1", expiresAt: new Date("2026-01-01T00:00:00.000Z") },
    user: { id: "user-1" },
  },
};

const SIGNED_IN: BrowserSessionResolution = {
  kind: "signed_in",
  session: {
    sessionId: "session-1",
    expires: "2026-01-01T00:00:00.000Z",
    user: { id: "user-1", email: "bob@example.com", name: "Bob", image: null },
  },
};

function door(overrides: Partial<AuthDoorDeps> = {}) {
  const handler = vi.fn<(request: Request) => Promise<Response>>(async () =>
    Response.json({ handledByBetterAuth: true }),
  );
  const revokeBrowserSession = vi.fn<AuthDoorDeps["revokeBrowserSession"]>(async () => {});
  const verifyBrowserSession = vi.fn<AuthDoorDeps["verifyBrowserSession"]>(async () => VERIFIED);
  const service = AuthDoorService.create({
    betterAuth: async () => ({ handler }),
    baseUrl: () => BASE_URL,
    verifyBrowserSession,
    resolveBrowserSession: async () => SIGNED_IN,
    revokeBrowserSession,
    deriveQueryCacheKey: ({ sessionId, impersonatorId, epoch }) =>
      `key-for-${sessionId}-${impersonatorId}-${epoch}`,
    // Two epochs and a day in: the server's clock alone names the epoch.
    now: () => Temporal.Instant.fromEpochMilliseconds(15 * 24 * 60 * 60 * 1000),
    ...overrides,
  });

  return { service, handler, revokeBrowserSession, verifyBrowserSession };
}

const signIn = () =>
  new Request(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      origin: BASE_URL,
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.8",
    },
    body: JSON.stringify({ email: "sam@acme.com", password: "hunter2" }),
  });

describe("AuthDoorService", () => {
  describe("when a sign-in call arrives claiming a forwarded address of its own", () => {
    /** @scenario "Better Auth counts the same caller the platform counts" */
    it("hands Better Auth the caller the platform resolved, over the one it claimed", async () => {
      const world = door();
      const request = signIn();
      ClientAddress.classifyByAddress().handle({ request, socketAddress: "198.51.100.11" });

      await world.service.betterAuthHandshake(request);

      const stated = world.handler.mock.calls[0]![0];
      expect(stated.headers.get("x-forwarded-for")).toBe("198.51.100.11");
      await expect(stated.text()).resolves.toBe(
        JSON.stringify({ email: "sam@acme.com", password: "hunter2" }),
      );
    });

    it("strips the claim when no caller could be resolved, so it cannot pick a bucket", async () => {
      const world = door();

      await world.service.betterAuthHandshake(signIn());

      expect(world.handler.mock.calls[0]![0].headers.get("x-forwarded-for")).toBeNull();
    });
  });

  describe("when a state-changing call comes from another origin", () => {
    /** @scenario "A cross-site sign-in post reaches no further than the refusal" */
    it("refuses it and never reaches Better Auth", async () => {
      const world = door();

      const response = await world.service.betterAuthHandshake(
        new Request(`${BASE_URL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        message: "Invalid origin",
        code: "INVALID_ORIGIN",
      });
      expect(world.handler).not.toHaveBeenCalled();
    });

    /** @scenario "The refused address is recorded for whoever runs the installation" */
    it("logs the address it expected beside the one it received", async () => {
      loggerSpies.warn.mockClear();

      await door().service.betterAuthHandshake(
        new Request(`${BASE_URL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }),
      );

      expect(loggerSpies.warn).toHaveBeenCalledWith(
        expect.objectContaining({ expectedOrigin: BASE_URL, receivedOrigin: "https://evil.test" }),
        expect.any(String),
      );
    });

    it("lets an identity provider's SAML assertion post reach Better Auth", async () => {
      const world = door();

      const response = await world.service.betterAuthHandshake(
        new Request(`${BASE_URL}/api/auth/sso/saml2/sp/acs/ssoc_acme`, {
          method: "POST",
          headers: { origin: "https://idp.example.com" },
          body: new URLSearchParams({ SAMLResponse: "assertion" }),
        }),
      );

      expect(response.status).toBe(200);
      expect(world.handler).toHaveBeenCalledTimes(1);
    });

    it("lets a read through whatever origin it names, so a callback still lands", async () => {
      const world = door();

      const response = await world.service.betterAuthHandshake(
        new Request(`${BASE_URL}/api/auth/callback/oidc`),
      );

      expect(response.status).toBe(200);
      expect(world.handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a sign-up procedure checks the web address it was called from", () => {
    /** @scenario "A sign-up on a web address the installation is not set up for writes no account" */
    it("refuses a foreign origin with the invalid origin code, logging origins only", async () => {
      loggerSpies.warn.mockClear();

      expect(() =>
        door().service.assertSignUpOrigin({
          origin: "http://localhost:18560",
          referer: "http://localhost:18560/auth/signup?verify=secret",
        }),
      ).toThrow(expect.objectContaining({ code: "auth_invalid_origin" }));
      expect(loggerSpies.warn).toHaveBeenCalledWith(
        {
          expectedOrigin: BASE_URL,
          receivedOrigin: "http://localhost:18560",
          receivedReferer: "http://localhost:18560",
        },
        expect.any(String),
      );
    });

    /** @scenario "A sign-up request that names no web address is refused" */
    it("refuses a request carrying neither an origin nor a referer", () => {
      expect(() => door().service.assertSignUpOrigin({ origin: null, referer: null })).toThrow(
        expect.objectContaining({ code: "auth_invalid_origin" }),
      );
    });

    it("accepts the configured address, from a referer when no origin is sent", () => {
      expect(() =>
        door().service.assertSignUpOrigin({
          origin: null,
          referer: `${BASE_URL}/auth/signup`,
        }),
      ).not.toThrow();
    });
  });

  describe("when the browser polls its session", () => {
    /** @scenario "The session read carries this epoch's key and the last" */
    it("publishes the resolved session's document with its user's keys for this epoch and the last", async () => {
      const world = door();

      await expect(world.service.getSessionByCookie({ cookie: SESSION_COOKIE })).resolves.toEqual({
        document: {
          session: { expiresAt: "2026-01-01T00:00:00.000Z" },
          user: { id: "user-1", email: "bob@example.com", name: "Bob", image: null },
          cacheKey: "key-for-session-1-undefined-2",
          previousCacheKey: "key-for-session-1-undefined-1",
        },
      });
      expect(world.verifyBrowserSession.mock.calls[0]![0].headers.get("cookie")).toBe(
        SESSION_COOKIE,
      );
    });

    /** @scenario "A revoked session's key is gone" */
    it("publishes no document, so no key, for a session whose row was revoked", async () => {
      const world = door({ resolveBrowserSession: async () => ({ kind: "anonymous" }) });

      await expect(world.service.getSessionByCookie({ cookie: SESSION_COOKIE })).resolves.toEqual({
        document: null,
      });
    });

    it("publishes null for a caller Better Auth does not know", async () => {
      const world = door({ verifyBrowserSession: async () => ({ kind: "anonymous" }) });

      await expect(world.service.getSessionByCookie({ cookie: undefined })).resolves.toEqual({
        document: null,
      });
    });
  });

  describe("when the browser signs out", () => {
    it("revokes the session its cookies name", async () => {
      const world = door();

      await world.service.revokeSessionFromCookies({ cookie: SESSION_COOKIE });

      expect(world.revokeBrowserSession).toHaveBeenCalledWith({ sessionId: "session-1" });
    });

    it("still resolves when the session lookup fails, so the cookies are cleared", async () => {
      const world = door({
        verifyBrowserSession: async () => {
          throw new Error("store down");
        },
      });

      await expect(
        world.service.revokeSessionFromCookies({ cookie: SESSION_COOKIE }),
      ).resolves.toBeUndefined();
      expect(world.revokeBrowserSession).not.toHaveBeenCalled();
    });

    it("looks nothing up for a caller carrying no session cookie", async () => {
      const world = door();

      await world.service.revokeSessionFromCookies({ cookie: undefined });

      expect(world.verifyBrowserSession).not.toHaveBeenCalled();
    });
  });

  describe("when a sign-in callback fails on the server", () => {
    /** @scenario "A sign-in callback that fails on the server lands on the error screen" */
    it("redirects the browser to the error screen with the generic code", async () => {
      const world = door({
        betterAuth: async () => ({
          handler: async () =>
            Response.json(
              { code: "INTERNAL_SERVER_ERROR", message: "rekey failed" },
              { status: 500 },
            ),
        }),
      });

      const answered = await world.service.betterAuthHandshake(
        new Request(`${BASE_URL}/api/auth/callback/microsoft?code=c&state=s`),
      );

      expect(answered.status).toBe(302);
      const location = new URL(answered.headers.get("location") ?? "");
      expect(`${location.origin}${location.pathname}`).toBe(`${BASE_URL}/auth/error`);
      expect(location.searchParams.get("error")).toBe("sign_in_failed");
    });
  });

  describe("when a sign-in is redirected to the error screen", () => {
    /** @scenario "An internal code never travels" */
    it("sends an unwritten code as the generic one and keeps an admitted one", async () => {
      const redirectingTo = (location: string) =>
        door({
          betterAuth: async () => ({
            handler: async () => new Response(null, { status: 302, headers: { location } }),
          }),
        });
      const callback = () => new Request(`${BASE_URL}/api/auth/sso/callback/conn_1?code=c`);

      const internal = await redirectingTo(
        `${BASE_URL}/auth/error?error=SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS`,
      ).service.betterAuthHandshake(callback());
      const admitted = await redirectingTo(
        `${BASE_URL}/auth/error?error=SSO_PROVIDER_NOT_ALLOWED`,
      ).service.betterAuthHandshake(callback());

      expect(new URL(internal.headers.get("location") ?? "").searchParams.get("error")).toBe(
        "sign_in_failed",
      );
      expect(new URL(admitted.headers.get("location") ?? "").searchParams.get("error")).toBe(
        "SSO_PROVIDER_NOT_ALLOWED",
      );
    });
  });

  describe("when an auth route that is not a callback fails on the server", () => {
    /** @scenario "A server error on an auth route that is not a callback keeps its status" */
    it("answers with the server error itself", async () => {
      const world = door({
        betterAuth: async () => ({ handler: async () => new Response(null, { status: 500 }) }),
      });

      const answered = await world.service.betterAuthHandshake(signIn());

      expect(answered.status).toBe(500);
    });
  });
});
