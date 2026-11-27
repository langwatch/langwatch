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
import type { IdentityApi } from "@langwatch/identity-contract";
import type * as observabilityModule from "@langwatch/observability";
import type * as tracingModule from "@langwatch/observability/tracing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { IdTokenIssuerRefusalChannel } from "../../channels/http/http.id-token-issuer-refusal.channel.ts";
import { OAuthProfileEmailChannel } from "../../channels/http/http.oauth-profile-email.channel.ts";
import {
  SIGN_IN_HINT_COOKIE,
  SIGN_IN_HINT_TTL_MS,
  UNFINISHED_SIGN_IN_TTL_MS,
  roundTripBindingOf,
  signInHintSealer,
} from "../../rules/sign-in-hint.rules.ts";
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
const activeTrace = vi.hoisted(() => ({ id: undefined as string | undefined }));
vi.mock("@langwatch/observability/tracing", async (importOriginal) => ({
  ...(await importOriginal<typeof tracingModule>()),
  getActiveTraceId: () => activeTrace.id,
}));

const HINT_SECRET = "test-session-secret";
const NOW_MS = 15 * 24 * 60 * 60 * 1000;

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
    idTokenIssuerRefusals: IdTokenIssuerRefusalChannel.create(),
    connectionIssuers: { findIssuersForConnection: async () => [] },
    oauthProfileEmails: OAuthProfileEmailChannel.create(),
    governingConnections: { findGoverningConnections: async () => [] },
    deriveQueryCacheKey: ({ sessionId, impersonatorId, epoch }) =>
      `key-for-${sessionId}-${impersonatorId}-${epoch}`,
    // Two epochs and a day in: the server's clock alone names the epoch.
    now: () => Temporal.Instant.fromEpochMilliseconds(NOW_MS),
    signInHints: () => signInHintSealer({ secret: HINT_SECRET }),
    refusedSignIns: createApiFixture<IdentityApi>({
      classifyRefusedSignIn: async () => ({ organizationId: null, idp: null, outcome: "refused" }),
    }),
    newReferenceId: () => "ref_generated",
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
      ClientAddress.fromTrustedProxies({ addresses: [] }).handle({
        request,
        socketAddress: "198.51.100.11",
      });

      await world.service.betterAuthHandshake(request);

      const stated = world.handler.mock.calls[0]![0];
      expect(stated.headers.get("x-forwarded-for")).toBe("198.51.100.11");
      await expect(stated.text()).resolves.toBe(
        JSON.stringify({ email: "sam@acme.com", password: "hunter2" }),
      );
    });

    /** @scenario "Every public auth entrance resolves its caller the same way" */
    it("states the resolved caller on an account registration too, not the one it claimed", async () => {
      const world = door();
      const request = new Request(`${BASE_URL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          origin: BASE_URL,
          "content-type": "application/json",
          "x-forwarded-for": "10.9.9.9, 203.0.113.8",
        },
        body: JSON.stringify({ email: "new@acme.com", password: "hunter2hunter2", name: "New" }),
      });
      ClientAddress.fromTrustedProxies({ addresses: [] }).handle({
        request,
        socketAddress: "198.51.100.11",
      });

      await world.service.betterAuthHandshake(request);

      expect(world.handler.mock.calls[0]![0].headers.get("x-forwarded-for")).toBe("198.51.100.11");
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

    it("reports a failed session lookup instead of confirming the sign-out", async () => {
      const world = door({
        verifyBrowserSession: async () => {
          throw new Error("session lookup unavailable");
        },
      });

      await expect(
        world.service.revokeSessionFromCookies({ cookie: SESSION_COOKIE }),
      ).rejects.toThrow("session lookup unavailable");
      expect(world.revokeBrowserSession).not.toHaveBeenCalled();
    });

    /** @scenario "Logout reports a revocation failure instead of confirming success" */
    it("reports a failed revocation instead of confirming the sign-out", async () => {
      const world = door();
      world.revokeBrowserSession.mockRejectedValueOnce(new Error("session store unavailable"));

      await expect(
        world.service.revokeSessionFromCookies({ cookie: SESSION_COOKIE }),
      ).rejects.toThrow("session store unavailable");
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

  describe("when a sign-in fails with a provider code we have not written down", () => {
    /** @scenario "The logged cause names the provider's code" */
    it("logs a SignInRefusal cause carrying that code", async () => {
      loggerSpies.error.mockClear();
      const world = door({
        betterAuth: async () => ({
          handler: async () =>
            new Response(null, {
              status: 302,
              headers: { location: `${BASE_URL}/auth/error?error=state_not_found` },
            }),
        }),
      });

      await world.service.betterAuthHandshake(
        new Request(`${BASE_URL}/api/auth/sso/callback/conn_1?code=c`),
      );

      expect(loggerSpies.error).toHaveBeenCalledTimes(1);
      const [fields] = loggerSpies.error.mock.calls[0] ?? [];
      const cause = (fields as { error?: Error & { code?: string } }).error;
      expect(cause?.constructor.name).toBe("SignInRefusal");
      expect(cause?.name).toBe("SignInRefusal");
      expect(cause?.code).toBe("state_not_found");
    });
  });

  describe("when an identity provider refuses the person with access_denied", () => {
    /** @scenario "A provider's access_denied refusal crosses and is logged as a warning" */
    it("keeps only the code on the redirect and logs it at warn without the description", async () => {
      loggerSpies.warn.mockClear();
      loggerSpies.error.mockClear();
      const answered = await refusing().service.betterAuthHandshake(refusedCallback());

      const location = new URL(answered.headers.get("location") ?? "");
      expect(location.searchParams.get("error")).toBe("access_denied");
      expect(location.searchParams.has("error_description")).toBe(false);
      expect(loggerSpies.error).not.toHaveBeenCalled();
      expect(loggerSpies.warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(loggerSpies.warn.mock.calls)).not.toContain("not assigned");
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

describe("given an OAuth sign-in Better Auth would not link to the account holding its address", () => {
  const NOT_LINKED_AT = `${BASE_URL}/auth/error?error=account_not_linked`;
  const callback = () => new Request(`${BASE_URL}/api/auth/callback/google?code=c&state=s`);

  /** Better Auth maps the provider's profile in the callback, then refuses the link. */
  function doorRefusingLink({
    governing,
    location = NOT_LINKED_AT,
  }: {
    governing: Record<string, string[]>;
    location?: string;
  }) {
    const oauthProfileEmails = OAuthProfileEmailChannel.create();
    const google = oauthProfileEmails.capturing({ clientId: "google" });
    const asked: string[] = [];
    const handler = vi.fn(async () => {
      await google.mapProfileToUser({ email: "andrei@acme.com", sub: "g-1" });
      return new Response(null, { status: 302, headers: { location } });
    });
    const { service } = door({
      betterAuth: async () => ({ handler }),
      oauthProfileEmails,
      governingConnections: {
        findGoverningConnections: async ({ email }) => {
          asked.push(email);
          return governing[email] ?? [];
        },
      },
    });
    return { service, asked };
  }

  describe("when an organization's connection governs the provider's address", () => {
    /** @scenario "Signing in with the wrong method explains what to do and names the right method" */
    it("names that connection in error_description on the redirect to the error page", async () => {
      const { service, asked } = doorRefusingLink({
        governing: { "andrei@acme.com": ["ssoc_acme"] },
      });

      const response = await service.betterAuthHandshake(callback());
      const target = new URL(response.headers.get("location") ?? "");

      expect(asked).toEqual(["andrei@acme.com"]);
      expect(target.pathname).toBe("/auth/error");
      expect(target.searchParams.get("error")).toBe("account_not_linked");
      expect(target.searchParams.get("error_description")).toBe("ssoc_acme");
    });
  });

  describe("when no connection governs the address", () => {
    /** @scenario "Recovery works the same when the org's required method is not yet known" */
    it("leaves the redirect naming no connection", async () => {
      const { service } = doorRefusingLink({ governing: {} });

      const response = await service.betterAuthHandshake(callback());

      expect(response.headers.get("location")).toBe(NOT_LINKED_AT);
    });
  });

  describe("when the redirect is some other refusal", () => {
    it("asks nobody who governs the address", async () => {
      const { service, asked } = doorRefusingLink({
        governing: { "andrei@acme.com": ["ssoc_acme"] },
        location: `${BASE_URL}/auth/error?error=DIFFERENT_EMAIL_NOT_ALLOWED`,
      });

      await service.betterAuthHandshake(callback());

      expect(asked).toEqual([]);
    });
  });

  describe("when a profile is mapped outside any request", () => {
    it("keeps nothing", async () => {
      const channel = OAuthProfileEmailChannel.create();
      await channel.capturing({}).mapProfileToUser({ email: "andrei@acme.com" });

      expect(channel.findEmail()).toBeUndefined();
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

const REFUSED_LOCATION = `${BASE_URL}/auth/error?error=access_denied&error_description=User+is+not+assigned`;
const CONNECTION = "ssoc_acme";

function refusing(overrides: Partial<AuthDoorDeps> = {}) {
  return door({
    betterAuth: async () => ({
      handler: async () =>
        new Response(null, { status: 302, headers: { location: REFUSED_LOCATION } }),
    }),
    ...overrides,
  });
}

/** The `state`/`RelayState` the person's own sign-in start was sent to the provider with. */
const ROUND_TRIP = "rt-started-here";

function sealedHint({
  email = "new.hire@acme.com",
  providerId = CONNECTION,
  issuedAt = NOW_MS - 60_000,
  secret = HINT_SECRET,
  roundTrip = ROUND_TRIP,
}: {
  email?: string;
  providerId?: string;
  issuedAt?: number;
  secret?: string;
  roundTrip?: string;
} = {}): string {
  const binding = roundTripBindingOf({ value: roundTrip });
  return signInHintSealer({ secret }).seal({ email, providerId, issuedAt, binding });
}

function refusedCallback({
  path = `/api/auth/sso/callback/${CONNECTION}`,
  hint,
  state = ROUND_TRIP,
}: { path?: string; hint?: string; state?: string } = {}): Request {
  return new Request(`${BASE_URL}${path}?error=access_denied&state=${state}`, {
    headers: hint === undefined ? {} : { cookie: `other=1; ${SIGN_IN_HINT_COOKIE}=${hint}` },
  });
}

const SAML_NO_ASSERTION_LOCATION = `${BASE_URL}/auth/error?error=saml_no_assertion&error_description=SAML+response+contains+no+assertions`;

function samlPost({
  status,
  hint,
  relayState = ROUND_TRIP,
}: {
  status: string;
  hint?: string;
  relayState?: string;
}): Request {
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><samlp:Status><samlp:StatusCode Value="${status}"><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:RequestDenied"/></samlp:StatusCode></samlp:Status></samlp:Response>`;
  const body = new URLSearchParams({
    SAMLResponse: Buffer.from(xml).toString("base64"),
    RelayState: relayState,
  });
  return new Request(`${BASE_URL}/api/auth/sso/saml2/sp/acs/${CONNECTION}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://idp.acme.test",
      ...(hint === undefined ? {} : { cookie: `${SIGN_IN_HINT_COOKIE}=${hint}` }),
    },
    body: body.toString(),
  });
}

function classifier(answer: Awaited<ReturnType<IdentityApi["classifyRefusedSignIn"]>>) {
  const calls: Parameters<IdentityApi["classifyRefusedSignIn"]>[0][] = [];
  const refusedSignIns = createApiFixture<IdentityApi>({
    classifyRefusedSignIn: async (input) => {
      calls.push(input);
      return answer;
    },
  });
  return { refusedSignIns, calls };
}

const locationOf = (response: Response) => new URL(response.headers.get("location") ?? "");

describe("given an identity provider that refused a sign-in started on our page", () => {
  describe("when the organization would hold the person for want of a seat", () => {
    /** @scenario "A refused person the organization would hold for a seat sees the seat-limit screen first" */
    it("sends the seat-limit code and hands identity the hinted address", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "seat_limit",
      });

      const answered = await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback({ hint: sealedHint() }),
      );

      expect(locationOf(answered).searchParams.get("error")).toBe("seat_limit_reached");
      expect(locationOf(answered).searchParams.has("idp")).toBe(false);
      expect(calls).toEqual([
        { refusedBy: { kind: "connection", connectionId: CONNECTION }, email: "new.hire@acme.com" },
      ]);
    });
  });

  describe("when the organization has a seat free", () => {
    /** @scenario "A refused person at an organization with seats free is told the provider refused" */
    it("sends access_denied with the provider kind", async () => {
      const { refusedSignIns } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });

      const answered = await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback({ hint: sealedHint() }),
      );

      expect(locationOf(answered).searchParams.get("error")).toBe("access_denied");
      expect(locationOf(answered).searchParams.get("idp")).toBe("okta");
    });
  });

  describe("when a SAML provider posts back a Response whose status refuses", () => {
    /** @scenario "A SAML refusal posted back is classified like an OIDC refusal" */
    it("sends the seat-limit code and hands identity the hinted address", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "saml",
        outcome: "seat_limit",
      });
      const world = door({
        refusedSignIns,
        betterAuth: async () => ({
          handler: async () =>
            new Response(null, { status: 302, headers: { location: SAML_NO_ASSERTION_LOCATION } }),
        }),
      });

      const answered = await world.service.betterAuthHandshake(
        samlPost({ status: "urn:oasis:names:tc:SAML:2.0:status:Responder", hint: sealedHint() }),
      );

      expect(locationOf(answered).searchParams.get("error")).toBe("seat_limit_reached");
      expect(calls).toEqual([
        { refusedBy: { kind: "connection", connectionId: CONNECTION }, email: "new.hire@acme.com" },
      ]);
    });

    it("keeps the generic failure when the posted status is Success", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "saml",
        outcome: "refused",
      });
      const world = door({
        refusedSignIns,
        betterAuth: async () => ({
          handler: async () =>
            new Response(null, { status: 302, headers: { location: SAML_NO_ASSERTION_LOCATION } }),
        }),
      });

      const answered = await world.service.betterAuthHandshake(
        samlPost({ status: "urn:oasis:names:tc:SAML:2.0:status:Success" }),
      );

      expect(locationOf(answered).searchParams.get("error")).toBe("sign_in_failed");
      expect(calls).toEqual([]);
    });
  });

  describe("when a refusal does not echo the round trip the hint was bound to", () => {
    /** @scenario "A refusal that does not echo the sign-in's round trip names nobody" */
    it("asks identity with no address for a forged OIDC refusal", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });

      await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback({ hint: sealedHint(), state: "rt-forged" }),
      );

      expect(calls[0]?.email).toBeNull();
    });

    /** @scenario "A refusal that does not echo the sign-in's round trip names nobody" */
    it("asks identity with no address for a forged SAML refusal", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "saml",
        outcome: "refused",
      });
      const world = door({
        refusedSignIns,
        betterAuth: async () => ({
          handler: async () =>
            new Response(null, { status: 302, headers: { location: SAML_NO_ASSERTION_LOCATION } }),
        }),
      });

      const answered = await world.service.betterAuthHandshake(
        samlPost({
          status: "urn:oasis:names:tc:SAML:2.0:status:Responder",
          hint: sealedHint(),
          relayState: "rt-forged",
        }),
      );

      expect(locationOf(answered).searchParams.get("error")).toBe("access_denied");
      expect(calls[0]?.email).toBeNull();
    });

    it("asks identity with no address for a hint sealed without a round trip", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });
      const unbound = signInHintSealer({ secret: HINT_SECRET }).seal({
        email: "new.hire@acme.com",
        providerId: CONNECTION,
        issuedAt: NOW_MS - 60_000,
      });

      await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback({ hint: unbound }),
      );

      expect(calls[0]?.email).toBeNull();
    });
  });

  describe("when a posted callback is larger than any provider response", () => {
    /** @scenario "An oversized posted callback is not read for its status" */
    it("reads no status from it and still hands Better Auth the whole body", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "saml",
        outcome: "seat_limit",
      });
      const received: number[] = [];
      const world = door({
        refusedSignIns,
        betterAuth: async () => ({
          handler: async (forwarded: Request) => {
            received.push((await forwarded.text()).length);
            return new Response(null, {
              status: 302,
              headers: { location: SAML_NO_ASSERTION_LOCATION },
            });
          },
        }),
      });
      const posted = samlPost({
        status: "urn:oasis:names:tc:SAML:2.0:status:Responder",
        hint: sealedHint(),
      });
      const padded = `${await posted.text()}&pad=${"a".repeat(600 * 1024)}`;

      const answered = await world.service.betterAuthHandshake(
        new Request(posted.url, { method: "POST", headers: posted.headers, body: padded }),
      );

      expect(locationOf(answered).searchParams.get("error")).toBe("sign_in_failed");
      expect(calls).toEqual([]);
      expect(received).toEqual([padded.length]);
    });
  });

  describe("when classifying the refusal does not answer in time", () => {
    /** @scenario "A refused sign-in's redirect never waits long on classifying it" */
    it("sends the plain refusal with its reference while the classification carries on", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const calls: unknown[] = [];
        const refusedSignIns = createApiFixture<IdentityApi>({
          classifyRefusedSignIn: (input) => {
            calls.push(input);
            return new Promise(() => void 0);
          },
        });

        const pending = refusing({ refusedSignIns }).service.betterAuthHandshake(
          refusedCallback({ hint: sealedHint() }),
        );
        await vi.advanceTimersByTimeAsync(3_000);
        const answered = await pending;

        expect(calls).toHaveLength(1);
        expect(locationOf(answered).searchParams.get("error")).toBe("access_denied");
        expect(locationOf(answered).searchParams.get("trace")).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("logs a classification that fails after the redirect stopped waiting, with its reference", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      loggerSpies.warn.mockClear();
      try {
        const late = new Error("identity answered late and failed");
        const refusedSignIns = createApiFixture<IdentityApi>({
          classifyRefusedSignIn: () =>
            new Promise((_resolve, reject) => setTimeout(() => reject(late), 5_000)),
        });

        const pending = refusing({ refusedSignIns }).service.betterAuthHandshake(
          refusedCallback({ hint: sealedHint() }),
        );
        await vi.advanceTimersByTimeAsync(3_000);
        const reference = locationOf(await pending).searchParams.get("trace");
        await vi.advanceTimersByTimeAsync(2_000);

        expect(loggerSpies.warn).toHaveBeenCalledWith(
          { error: late, reference },
          "classifying a refused sign-in failed after the redirect stopped waiting on it",
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when the callback carries no hint", () => {
    /** @scenario "Without a known address nobody is told and no seat is requested" */
    it("asks identity with no address", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "entra",
        outcome: "refused",
      });

      const answered = await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback(),
      );

      expect(calls[0]?.email).toBeNull();
      expect(locationOf(answered).searchParams.get("idp")).toBe("entra");
    });
  });

  describe("when the hint is tampered, signed with another key or expired", () => {
    /** @scenario "A forged or tampered hint cookie is ignored" */
    it.each([
      ["tampered", () => `${sealedHint()}x`],
      ["re-signed", () => sealedHint({ secret: "another-secret" })],
      ["expired", () => sealedHint({ issuedAt: NOW_MS - SIGN_IN_HINT_TTL_MS - 1 })],
      ["from the future", () => sealedHint({ issuedAt: NOW_MS + 10 * 60 * 1000 })],
    ])("treats the address as unknown when %s", async (_label, hint) => {
      const { refusedSignIns, calls } = classifier({
        organizationId: null,
        idp: null,
        outcome: "refused",
      });

      await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback({ hint: hint() }),
      );

      expect(calls[0]?.email).toBeNull();
    });
  });

  describe("when the hint was set for another provider", () => {
    /** @scenario "A hint for another provider is ignored" */
    it("treats the address as unknown", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: null,
        idp: null,
        outcome: "refused",
      });

      await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback({ hint: sealedHint({ providerId: "ssoc_other" }) }),
      );

      expect(calls[0]?.email).toBeNull();
    });
  });

  describe("when the refusal is answered", () => {
    /** @scenario "The card's reference is the one the log line carries" */
    it("logs one warning with the reference and no address, and redirects with that reference", async () => {
      loggerSpies.warn.mockClear();
      activeTrace.id = "trace_active";
      const { refusedSignIns } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });

      const answered = await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback({ hint: sealedHint() }),
      );
      activeTrace.id = undefined;

      expect(loggerSpies.warn).toHaveBeenCalledTimes(1);
      const [fields] = loggerSpies.warn.mock.calls[0] ?? [];
      expect(fields).toEqual({
        reference: "trace_active",
        providerId: CONNECTION,
        answeredCode: "access_denied",
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });
      expect(JSON.stringify(loggerSpies.warn.mock.calls)).not.toContain("new.hire");
      expect(locationOf(answered).searchParams.get("trace")).toBe("trace_active");
    });

    /** @scenario "Without an active trace a generated reference is logged and shown" */
    it("generates a reference when no trace is active", async () => {
      loggerSpies.warn.mockClear();

      const answered = await refusing().service.betterAuthHandshake(refusedCallback());

      expect(loggerSpies.warn.mock.calls[0]?.[0]).toMatchObject({ reference: "ref_generated" });
      expect(locationOf(answered).searchParams.get("trace")).toBe("ref_generated");
    });

    /** @scenario "The hint is set when a sign-in starts and dropped once the callback answers" */
    it("clears the hint cookie on the callback's answer", async () => {
      const answered = await refusing().service.betterAuthHandshake(
        refusedCallback({ hint: sealedHint() }),
      );

      const cookie = answered.headers.get("set-cookie") ?? "";
      expect(cookie).toContain(`${SIGN_IN_HINT_COOKIE}=;`);
      expect(cookie).toContain("Max-Age=0");
    });
  });

  describe("when classifying the refusal fails", () => {
    /** @scenario "A failure classifying the refusal still lands on the plain refusal" */
    it("still redirects with access_denied and the reference", async () => {
      loggerSpies.error.mockClear();
      const refusedSignIns = createApiFixture<IdentityApi>({
        classifyRefusedSignIn: async () => {
          throw new Error("organization unavailable");
        },
      });

      const answered = await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback({ hint: sealedHint() }),
      );

      expect(answered.status).toBe(302);
      expect(locationOf(answered).searchParams.get("error")).toBe("access_denied");
      expect(locationOf(answered).searchParams.has("idp")).toBe(false);
      expect(locationOf(answered).searchParams.get("trace")).toBe("ref_generated");
      expect(loggerSpies.error).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given a provider sign-in started on our page with a typed address", () => {
  const start = (body: unknown) =>
    new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  describe("when Better Auth accepts the start", () => {
    /** @scenario "The hint is set when a sign-in starts and dropped once the callback answers" */
    it("sets a signed, httpOnly hint for an hour that rides a cross-site SAML post", async () => {
      const world = door();
      world.handler.mockImplementation(async () =>
        Response.json({ url: `https://idp.acme.test/sso?SAMLRequest=x&RelayState=${ROUND_TRIP}` }),
      );
      const body = { providerId: CONNECTION, loginHint: "New.Hire@acme.com", callbackURL: "/" };

      const answered = await world.service.betterAuthHandshake(start(body));

      await expect(world.handler.mock.calls[0]![0].text()).resolves.toBe(JSON.stringify(body));
      const cookie = answered.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(new RegExp(`^${SIGN_IN_HINT_COOKIE.replace(".", "\\.")}=[^;]+;`));
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=None");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("Path=/api/auth;");
      expect(cookie).toContain(`Max-Age=${UNFINISHED_SIGN_IN_TTL_MS / 1000}`);
      const value = cookie.split(";")[0]!.split("=")[1]!;
      expect(
        signInHintSealer({ secret: HINT_SECRET }).decode({ value, nowMs: NOW_MS }),
      ).toMatchObject({
        email: "new.hire@acme.com",
        providerId: CONNECTION,
        binding: roundTripBindingOf({ value: ROUND_TRIP }),
      });
    });

    /** @scenario "A refusal that does not echo the sign-in's round trip names nobody" */
    it("sets no hint when its answer carries no round-trip value", async () => {
      const world = door();

      const answered = await world.service.betterAuthHandshake(
        start({ providerId: CONNECTION, loginHint: "a@acme.com" }),
      );

      expect(answered.headers.get("set-cookie")).toBeNull();
    });
  });

  describe("when the start body is larger than any sign-in start", () => {
    /** @scenario "An oversized sign-in start is not read for its hint" */
    it("sets no hint and still hands Better Auth the whole body", async () => {
      const world = door();
      world.handler.mockImplementation(async () =>
        Response.json({ url: `https://idp.acme.test/sso?RelayState=${ROUND_TRIP}` }),
      );
      const body = { providerId: CONNECTION, loginHint: "a@acme.com", pad: "a".repeat(32 * 1024) };

      const answered = await world.service.betterAuthHandshake(start(body));

      await expect(world.handler.mock.calls[0]![0].text()).resolves.toBe(JSON.stringify(body));
      expect(answered.headers.get("set-cookie")).toBeNull();
    });
  });

  describe("when Better Auth refuses the start", () => {
    it("sets no hint", async () => {
      const world = door({
        betterAuth: async () => ({ handler: async () => new Response(null, { status: 400 }) }),
      });

      const answered = await world.service.betterAuthHandshake(
        start({ providerId: CONNECTION, loginHint: "a@acme.com" }),
      );

      expect(answered.headers.get("set-cookie")).toBeNull();
    });
  });
});

describe("given an identity provider that sends refused people to its access error page", () => {
  const refusalPage = (connectionId: string) =>
    new Request(`${BASE_URL}/api/auth/sso/refused/${connectionId}`);

  describe("when the admin set the connection's refusal page URL there", () => {
    /** @scenario "A provider's access error page can send the person to our refusal card" */
    it("lands on the refusal card with the provider kind and names nobody", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });
      let betterAuthCalled = false;
      const { service } = door({
        refusedSignIns,
        betterAuth: async () => ({
          handler: async () => {
            betterAuthCalled = true;
            return new Response(null, { status: 404 });
          },
        }),
      });

      const answered = await service.betterAuthHandshake(refusalPage(CONNECTION));

      expect(answered.status).toBe(302);
      expect(`${locationOf(answered).origin}${locationOf(answered).pathname}`).toBe(
        `${BASE_URL}/auth/error`,
      );
      expect(locationOf(answered).searchParams.get("error")).toBe("access_denied");
      expect(locationOf(answered).searchParams.get("idp")).toBe("okta");
      expect(locationOf(answered).searchParams.get("trace")).toBeTruthy();
      expect(calls).toEqual([
        { refusedBy: { kind: "connection", connectionId: CONNECTION }, email: null },
      ]);
      expect(betterAuthCalled).toBe(false);
    });
  });

  describe("when the browser still holds the hint of the sign-in that was refused", () => {
    /** @scenario "A provider's access error page can send the person to our refusal card" */
    it("drops it, so the next visit does not call the sign-in unfinished", async () => {
      const { refusedSignIns } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });

      const answered = await door({ refusedSignIns }).service.betterAuthHandshake(
        new Request(`${BASE_URL}/api/auth/sso/refused/${CONNECTION}`, {
          headers: { cookie: `${SIGN_IN_HINT_COOKIE}=${sealedHint()}` },
        }),
      );

      expect(answered.headers.get("set-cookie")).toContain(`${SIGN_IN_HINT_COOKIE}=;`);
    });
  });

  describe("when the URL names no connection that classifies", () => {
    /** @scenario "A provider's access error page can send the person to our refusal card" */
    it("still lands on the plain refusal", async () => {
      const refusedSignIns = createApiFixture<IdentityApi>({
        classifyRefusedSignIn: async () => {
          throw new Error("lookup failed");
        },
      });

      const answered = await door({ refusedSignIns }).service.betterAuthHandshake(
        refusalPage("unknown"),
      );

      expect(locationOf(answered).searchParams.get("error")).toBe("access_denied");
      expect(locationOf(answered).searchParams.has("idp")).toBe(false);
    });
  });
});

describe("given a sign-in this browser started that its provider never answered", () => {
  const unfinishedRead = (hint?: string) =>
    new Request(`${BASE_URL}/api/auth/sign-in/unfinished`, {
      headers: hint === undefined ? {} : { cookie: `${SIGN_IN_HINT_COOKIE}=${hint}` },
    });

  describe("when the sign-in page asks within the hour", () => {
    /** @scenario "A sign-in that never came back is noticed on the next visit" */
    it("names the provider to dial and its kind, and tells nobody", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });

      const answered = await door({ refusedSignIns }).service.betterAuthHandshake(
        unfinishedRead(sealedHint({ issuedAt: NOW_MS - SIGN_IN_HINT_TTL_MS - 60_000 })),
      );

      await expect(answered.json()).resolves.toEqual({
        unfinished: { providerId: CONNECTION, idp: "okta" },
      });
      expect(answered.headers.get("cache-control")).toBe("no-store");
      expect(calls).toEqual([
        { refusedBy: { kind: "connection", connectionId: CONNECTION }, email: null },
      ]);
    });
  });

  describe("when there is no hint, or it is over an hour old", () => {
    /** @scenario "A sign-in that never came back is noticed on the next visit" */
    it.each([
      ["no hint", undefined],
      ["an expired hint", sealedHint({ issuedAt: NOW_MS - UNFINISHED_SIGN_IN_TTL_MS - 1 })],
      ["a forged hint", sealedHint({ secret: "another-secret" })],
      [
        "a social sign-in's hint",
        signInHintSealer({ secret: HINT_SECRET }).seal({
          providerId: "github",
          source: "provider",
          issuedAt: NOW_MS - 60_000,
        }),
      ],
    ])("answers none for %s", async (_, hint) => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });

      const answered = await door({ refusedSignIns }).service.betterAuthHandshake(
        unfinishedRead(hint),
      );

      await expect(answered.json()).resolves.toEqual({ unfinished: null });
      expect(calls).toEqual([]);
    });
  });

  describe("when a refused callback reads a hint older than 15 minutes", () => {
    /** @scenario "The hint is set when a sign-in starts and dropped once the callback answers" */
    it("does not name the person", async () => {
      const { refusedSignIns, calls } = classifier({
        organizationId: "org_1",
        idp: "okta",
        outcome: "refused",
      });

      await refusing({ refusedSignIns }).service.betterAuthHandshake(
        refusedCallback({ hint: sealedHint({ issuedAt: NOW_MS - SIGN_IN_HINT_TTL_MS - 60_000 }) }),
      );

      expect(calls[0]?.email).toBeNull();
    });
  });

  describe("when an answer starts a session some other way", () => {
    /** @scenario "The hint is set when a sign-in starts and dropped once the callback answers" */
    it("drops the hint, so nothing reads as unfinished afterwards", async () => {
      const world = door({
        betterAuth: async () => ({
          handler: async () =>
            new Response("{}", {
              status: 200,
              headers: { "set-cookie": "better-auth.session_token=abc; Path=/; HttpOnly" },
            }),
        }),
      });

      const answered = await world.service.betterAuthHandshake(
        new Request(`${BASE_URL}/api/auth/sign-in/email`, {
          method: "POST",
          headers: {
            origin: BASE_URL,
            "content-type": "application/json",
            cookie: `${SIGN_IN_HINT_COOKIE}=${sealedHint()}`,
          },
          body: JSON.stringify({ email: "sam@acme.com", password: "x" }),
        }),
      );

      const cookies = answered.headers.getSetCookie();
      expect(cookies.some((cookie) => cookie.startsWith(`${SIGN_IN_HINT_COOKIE}=;`))).toBe(true);
    });
  });
});
