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
import { describe, expect, it, vi } from "vitest";

import { IdTokenIssuerRefusalChannel } from "../../channels/http/http.id-token-issuer-refusal.channel.ts";
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
    isBornFinalizedSignUp: async () => false,
    baseUrl: () => BASE_URL,
    runWithIdentityBirth: (run) => run(),
    verifyBrowserSession,
    resolveBrowserSession: async () => SIGNED_IN,
    revokeBrowserSession,
    idTokenIssuerRefusals: IdTokenIssuerRefusalChannel.create(),
    connectionIssuers: { findIssuersForConnection: async () => [] },
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
    it("publishes the resolved session's document", async () => {
      const world = door();

      await expect(world.service.getSessionByCookie({ cookie: SESSION_COOKIE })).resolves.toEqual({
        document: {
          session: { expiresAt: "2026-01-01T00:00:00.000Z" },
          user: { id: "user-1", email: "bob@example.com", name: "Bob", image: null },
        },
      });
      expect(world.verifyBrowserSession.mock.calls[0]![0].headers.get("cookie")).toBe(
        SESSION_COOKIE,
      );
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

describe("given a single sign-on callback whose ID token the engine refused for its issuer", () => {
  const EXPECTED = "https://login.microsoftonline.com/app-tenant/v2.0";
  const RECEIVED = "https://login.microsoftonline.com/home-tenant/v2.0";
  const REFUSED_AT =
    "/settings/sso?ssoTest=c1&error=invalid_provider&error_description=token_not_verified";
  const callback = () =>
    new Request(`${BASE_URL}/api/auth/sso/callback/connection_1?code=c&state=s`, {
      headers: { origin: BASE_URL },
    });
  const issRefusal = (iss: string) =>
    Object.assign(new Error('unexpected "iss" claim value'), {
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
      claim: "iss",
      payload: { iss },
    });

  /** The engine's logger notes the refusal while the handler runs, then redirects. */
  function doorRefusing({ claim }: { claim: "iss" | "aud" }) {
    const idTokenIssuerRefusals = IdTokenIssuerRefusalChannel.create();
    const handler = vi.fn(async () => {
      idTokenIssuerRefusals.note([
        "the id token was not verified",
        Object.assign(issRefusal(RECEIVED), { claim }),
      ]);
      return new Response(null, { status: 302, headers: { location: REFUSED_AT } });
    });
    const { service } = door({
      betterAuth: async () => ({ handler }),
      idTokenIssuerRefusals,
      connectionIssuers: {
        findIssuersForConnection: async ({ connectionId }) =>
          connectionId === "connection_1" ? [EXPECTED] : [],
      },
    });
    return service;
  }

  describe("when the engine answered its generic token refusal", () => {
    /** @scenario "An ID token from another issuer is refused with both issuers named" */
    it("redirects with sso_issuer_mismatch naming both issuers", async () => {
      const response = await doorRefusing({ claim: "iss" }).betterAuthHandshake(callback());
      const location = response.headers.get("location") ?? "";
      const target = new URL(location, BASE_URL);

      expect(location.startsWith("/settings/sso")).toBe(true);
      expect(target.searchParams.get("error")).toBe("sso_issuer_mismatch");
      expect(target.searchParams.get("received_issuer")).toBe(RECEIVED);
      expect(target.searchParams.get("expected_issuer")).toBe(EXPECTED);
      expect(target.searchParams.get("error_description")).toBeNull();
      expect(target.searchParams.get("ssoTest")).toBe("c1");
    });
  });

  describe("when the refusal was for another claim", () => {
    it("leaves the redirect as it was", async () => {
      const response = await doorRefusing({ claim: "aud" }).betterAuthHandshake(callback());

      expect(response.headers.get("location")).toContain("error=invalid_provider");
    });
  });

  describe("when the logger notes a refusal outside any request", () => {
    it("ignores the line", () => {
      expect(() => IdTokenIssuerRefusalChannel.create().note([issRefusal(RECEIVED)])).not.toThrow();
    });
  });
});

describe("given Microsoft returning to the redirect URI Azure app registrations list", () => {
  describe("when the callback arrives at /api/auth/callback/azure-ad", () => {
    /** @scenario "Microsoft sign-in sends the redirect URI registered with Azure" */
    it("hands it to Better Auth under the Microsoft provider's own path", async () => {
      const { service, handler } = door();

      await service.betterAuthHandshake(
        new Request(`${BASE_URL}/api/auth/callback/azure-ad?code=c&state=s`),
      );

      const forwarded = new URL(handler.mock.calls[0]?.[0].url ?? "");
      expect(forwarded.pathname).toBe("/api/auth/callback/microsoft");
      expect(forwarded.search).toBe("?code=c&state=s");
    });
  });

  describe("when any other callback arrives", () => {
    it("leaves its path alone", async () => {
      const { service, handler } = door();

      await service.betterAuthHandshake(new Request(`${BASE_URL}/api/auth/callback/google?code=c`));

      expect(new URL(handler.mock.calls[0]?.[0].url ?? "").pathname).toBe(
        "/api/auth/callback/google",
      );
    });
  });
});
