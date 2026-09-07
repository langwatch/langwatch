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

const findAllIssuers = vi.fn();
const findIssuerForConnection = vi.fn();

let now = 1_000;
let allowlist: RegisteredIssuers;

beforeEach(() => {
  vi.clearAllMocks();
  findAllIssuers.mockResolvedValue([
    "https://acme.okta.com",
    "https://globex.okta.com",
  ]);
  findIssuerForConnection.mockResolvedValue("https://acme.okta.com");
  now = 1_000;
  allowlist = new RegisteredIssuers({
    issuers: { findAllIssuers, findIssuerForConnection },
    now: () => now,
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
      // The whole set is never read for a request that named one.
      expect(findAllIssuers).not.toHaveBeenCalled();
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
      expect(findAllIssuers).not.toHaveBeenCalled();
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
    it("falls back to every issuer, because the discovery fetch still has to be allowed", async () => {
      const issuers = await allowlist.issuersForRequest(
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

/**
 * One ceremony is several requests that each resolve the trusted origins, so
 * the whole-set read is remembered for a few seconds. The memory is a field on
 * the instance rather than a module binding, which is what makes it one
 * memory — and what makes this assertable at all.
 */
describe("given several requests of one sign-in ceremony", () => {
  describe("when none of them names a connection", () => {
    it("reads the whole set once for all of them", async () => {
      const domainFirst = () =>
        allowlist.issuersForRequest(
          post("https://app.langwatch.test/api/auth/sign-in/sso", {
            email: "sam@acme.com",
          }),
        );

      await domainFirst();
      await domainFirst();

      expect(findAllIssuers).toHaveBeenCalledOnce();
    });

    it("reads it again once the window has passed", async () => {
      await allowlist.registeredIssuers();
      now += 5_001;
      await allowlist.registeredIssuers();

      expect(findAllIssuers).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the read stops working", () => {
    /**
     * Degrading to the configured origins costs one refused single sign-in.
     * Throwing would cost every sign-in of every kind, which is why an
     * unreadable table answers with what was last known instead.
     */
    it("keeps answering what it last read rather than failing the request", async () => {
      expect(await allowlist.registeredIssuers()).toEqual([
        "https://acme.okta.com",
        "https://globex.okta.com",
      ]);

      findAllIssuers.mockRejectedValue(new Error("database down"));
      now += 5_001;

      expect(await allowlist.registeredIssuers()).toEqual([
        "https://acme.okta.com",
        "https://globex.okta.com",
      ]);
    });

    it("trusts nothing when it never read anything", async () => {
      findAllIssuers.mockRejectedValue(new Error("database down"));

      expect(await allowlist.registeredIssuers()).toEqual([]);
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
      expect(findAllIssuers).not.toHaveBeenCalled();
      expect(findIssuerForConnection).not.toHaveBeenCalled();
    });

    it("answers nothing for no request at all", async () => {
      expect(await allowlist.issuersForRequest(undefined)).toEqual([]);
    });
  });
});
