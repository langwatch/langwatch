import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const findFirst = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: { ssoProvider: { findMany, findFirst } },
}));

const { issuersForRequest } = await import("../registeredIssuers");

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

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([
    { issuer: "https://acme.okta.com" },
    { issuer: "https://globex.okta.com" },
  ]);
  findFirst.mockResolvedValue({ issuer: "https://acme.okta.com" });
});

describe("given a request that names one connection", () => {
  describe("when the connection is named in the callback path", () => {
    it("trusts that connection's issuer and no other tenant's", async () => {
      const issuers = await issuersForRequest(
        post("https://app.langwatch.test/api/auth/sso/callback/ssoc_acme"),
      );

      expect(issuers).toEqual(["https://acme.okta.com"]);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { providerId: "ssoc_acme" } }),
      );
      // The whole set is never read for a request that named one.
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe("when the connection is named in a sign-in body", () => {
    it("reads the body without consuming the caller's stream", async () => {
      const request = post("https://app.langwatch.test/api/auth/sign-in/sso", {
        providerId: "ssoc_acme",
        callbackURL: "https://app.langwatch.test/",
      });

      const issuers = await issuersForRequest(request);

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
      findFirst.mockResolvedValue(null);

      expect(
        await issuersForRequest(
          post("https://app.langwatch.test/api/auth/sso/callback/ssoc_ghost"),
        ),
      ).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});

describe("given a request that names no connection", () => {
  describe("when a domain-first sign-in has not resolved one yet", () => {
    it("falls back to every issuer, because the discovery fetch still has to be allowed", async () => {
      const issuers = await issuersForRequest(
        post("https://app.langwatch.test/api/auth/sign-in/sso", {
          email: "sam@acme.com",
        }),
      );

      expect(issuers).toEqual([
        "https://acme.okta.com",
        "https://globex.okta.com",
      ]);
    });
  });
});

describe("given a request that is not about single sign-on", () => {
  describe("when it reaches the trusted-origin resolution", () => {
    it("adds no customer origin at all, and asks the database nothing", async () => {
      expect(
        await issuersForRequest(
          post("https://app.langwatch.test/api/auth/sign-in/email"),
        ),
      ).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
      expect(findFirst).not.toHaveBeenCalled();
    });

    it("answers nothing for no request at all", async () => {
      expect(await issuersForRequest(undefined)).toEqual([]);
    });
  });
});
