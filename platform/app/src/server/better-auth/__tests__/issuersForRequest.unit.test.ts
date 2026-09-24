import { beforeEach, describe, expect, it, vi } from "vitest";

// The allowlist under test is constructed here, over an in-memory stand-in
// for the two reads it makes.
import { RegisteredIssuers } from "../registeredIssuers";

/**
 * Which issuers a single sign-on request is allowed to trust.
 *
 * `trustedOrigins` is not only the discovery allowlist it reads as.
 * better-auth's `originCheckMiddleware` runs the same list against the
 * `Origin` header of every cookie-bearing POST and against `callbackURL`,
 * `redirectTo` and `errorCallbackURL` — and `isSingleSignOnRequest` matches
 * any path containing `/sso`, which includes `/sign-in/sso`.
 *
 * So handing it every registered issuer made ONE tenant's origin a valid CSRF
 * origin and a valid redirect target on those endpoints for EVERY other
 * tenant. These cases are about the size of the answer, not its contents.
 */

const post = (url: string, body?: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const findIssuerForDomain = vi.fn();
const findIssuerForConnection = vi.fn();

let allowlist: RegisteredIssuers;

beforeEach(() => {
  vi.clearAllMocks();
  findIssuerForDomain.mockResolvedValue(null);
  findIssuerForConnection.mockResolvedValue("https://acme.okta.com");
  allowlist = new RegisteredIssuers({
    issuers: { findIssuerForConnection, findIssuerForDomain },
  });
});

describe("given a request that names one connection", () => {
  describe("when the connection is named in the callback path", () => {
    it("trusts that connection's issuer and no other tenant's", async () => {
      const issuers = await allowlist.issuersForRequest(
        post("https://app.langwatch.test/api/auth/sso/callback/ssoc_acme"),
      );

      expect(issuers).toEqual(["https://acme.okta.com"]);
      expect(findIssuerForConnection).toHaveBeenCalledWith({
        connectionId: "ssoc_acme",
      });
    });
  });

  describe("when the connection is named in a sign-in body", () => {
    it("reads the body without consuming the caller's stream", async () => {
      const request = post("https://app.langwatch.test/api/auth/sign-in/sso", {
        providerId: "ssoc_acme",
        callbackURL: "https://app.langwatch.test/",
      });

      const issuers = await allowlist.issuersForRequest(request);

      expect(issuers).toEqual(["https://acme.okta.com"]);
      // The handler still has to be able to read it.
      expect(request.bodyUsed).toBe(false);
      await expect(request.json()).resolves.toMatchObject({
        providerId: "ssoc_acme",
      });
    });
  });

  describe("when the named connection has no issuer we hold", () => {
    it("trusts nothing rather than falling back to everything", async () => {
      findIssuerForConnection.mockResolvedValue(null);

      expect(
        await allowlist.issuersForRequest(
          post("https://app.langwatch.test/api/auth/sso/callback/ssoc_ghost"),
        ),
      ).toEqual([]);
    });
  });

  describe("when that one row cannot be read", () => {
    it("trusts nothing rather than failing the sign-in", async () => {
      findIssuerForConnection.mockRejectedValue(new Error("database down"));

      expect(
        await allowlist.issuersForRequest(
          post("https://app.langwatch.test/api/auth/sso/callback/ssoc_acme"),
        ),
      ).toEqual([]);
    });
  });
});

describe("given a request that names no connection", () => {
  describe("when a domain-first sign-in has not resolved one yet", () => {
    it("adds no tenant issuer origins to an unnamed request", async () => {
      const issuers = await allowlist.issuersForRequest(
        post("https://app.langwatch.test/api/auth/sign-in/sso", {
          email: "sam@acme.com",
        }),
      );

      expect(issuers).toEqual([]);
    });
  });
});

describe("given a request that is not about single sign-on", () => {
  describe("when it reaches the trusted-origin resolution", () => {
    it("adds no customer origin at all, and asks the database nothing", async () => {
      expect(
        await allowlist.issuersForRequest(
          post("https://app.langwatch.test/api/auth/sign-in/email"),
        ),
      ).toEqual([]);
      expect(findIssuerForConnection).not.toHaveBeenCalled();
    });

    it("answers nothing for no request at all", async () => {
      expect(await allowlist.issuersForRequest(undefined)).toEqual([]);
    });
  });
});

/** @scenario "Unnamed SSO requests cannot trust another tenant's origin" */
it.each([
  "callbackURL",
  "redirectTo",
  "errorCallbackURL",
])("does not widen trust for %s without a provider", async (field) => {
  const request = new Request(
    "https://app.langwatch.test/api/auth/sign-in/sso",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://globex.okta.com",
      },
      body: JSON.stringify({
        email: "sam@acme.com",
        [field]: "https://globex.okta.com/return",
      }),
    },
  );
  expect(await allowlist.issuersForRequest(request)).toEqual([]);
  expect(request.bodyUsed).toBe(false);
});

it("narrows a domain-first request to its resolved issuer", async () => {
  findIssuerForDomain.mockResolvedValue("https://acme.okta.com");
  const request = post("https://app.langwatch.test/api/auth/sign-in/sso", {
    email: "sam@acme.com",
    callbackURL: "https://globex.okta.com/return",
  });
  expect(await allowlist.issuersForRequest(request)).toEqual([
    "https://acme.okta.com",
  ]);
  expect(findIssuerForDomain).toHaveBeenCalledWith({ domain: "acme.com" });
});
