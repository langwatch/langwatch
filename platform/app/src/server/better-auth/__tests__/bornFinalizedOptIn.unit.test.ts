import { beforeEach, describe, expect, it, vi } from "vitest";

// The composition root, which the module's thin export reaches for and these
// cases do not: the gate under test is constructed here, over in-memory
// stand-ins for the organization lookup and the allowlist itself.
vi.mock("~/server/app-layer/identity/runtime", () => ({
  bornFinalizedOptIn: vi.fn(),
}));

import { BornFinalizedOptIn } from "../bornFinalizedOptIn";

/**
 * ADR-116 §3's entrance, and the allowlist in front of it.
 *
 * The decision is taken at the route boundary because nothing below it can
 * take it: the user does not exist yet, so there is no organization to
 * evaluate a rule against and no state row for the write gate to read. What
 * these hold is the direction it fails in — off means "created the way every
 * user was created before this existed", and every unreadable input has to
 * land there.
 */

const findByDomain = vi.fn();
const isEnabled = vi.fn();

const gate = () =>
  new BornFinalizedOptIn({
    organizations: { findByDomain },
    flag: { isEnabled },
  });

const signUp = (
  body: unknown,
  url = "https://app.langwatch.test/api/auth/sign-up/email",
) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("given a sign-up posted to better-auth's own route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByDomain.mockResolvedValue(null);
    isEnabled.mockResolvedValue(true);
  });

  describe("when the allowlist admits the address", () => {
    it("routes the sign-up to the identity branch", async () => {
      expect(
        await gate().isBornFinalizedSignUp({
          request: signUp({ email: "sam@acme.com", password: "hunter2" }),
        }),
      ).toBe(true);
    });

    it("leaves better-auth its own body to read", async () => {
      const request = signUp({ email: "sam@acme.com" });

      await gate().isBornFinalizedSignUp({ request });

      expect(request.bodyUsed).toBe(false);
    });

    /**
     * The address is all the request carries, so the organization is resolved
     * the way `afterUserCreate` resolves it: by the domain the address names.
     */
    it("names the organization that claims the address's domain", async () => {
      findByDomain.mockResolvedValue({ id: "org_acme" });

      await gate().isBornFinalizedSignUp({
        request: signUp({ email: "sam@acme.com" }),
      });

      expect(findByDomain).toHaveBeenCalledWith({ domain: "acme.com" });
      expect(isEnabled).toHaveBeenCalledWith({
        distinctId: "sam@acme.com",
        organizationId: "org_acme",
      });
    });

    it("names no organization for a domain nobody claims", async () => {
      await gate().isBornFinalizedSignUp({
        request: signUp({ email: "sam@example.com" }),
      });

      expect(isEnabled).toHaveBeenCalledWith({
        distinctId: "sam@example.com",
        organizationId: null,
      });
    });
  });

  describe("when the allowlist does not admit the address", () => {
    it("leaves the sign-up on the legacy branch", async () => {
      isEnabled.mockResolvedValue(false);

      expect(
        await gate().isBornFinalizedSignUp({
          request: signUp({ email: "sam@acme.com" }),
        }),
      ).toBe(false);
    });
  });

  describe("when something it reads cannot be read", () => {
    it("takes the legacy branch when the allowlist itself is unreadable", async () => {
      isEnabled.mockRejectedValue(new Error("flag store down"));

      expect(
        await gate().isBornFinalizedSignUp({
          request: signUp({ email: "sam@acme.com" }),
        }),
      ).toBe(false);
    });

    it("takes the legacy branch when the organization lookup throws", async () => {
      findByDomain.mockRejectedValue(new Error("database down"));

      expect(
        await gate().isBornFinalizedSignUp({
          request: signUp({ email: "sam@acme.com" }),
        }),
      ).toBe(false);
    });
  });

  describe("when the body carries no address", () => {
    it("decides nothing, because there is nothing to evaluate a rule against", async () => {
      expect(await gate().isBornFinalizedSignUp({ request: signUp({}) })).toBe(
        false,
      );
      expect(isEnabled).not.toHaveBeenCalled();
    });

    it("decides nothing for a body that is not better-auth's shape", async () => {
      const request = new Request(
        "https://app.langwatch.test/api/auth/sign-up/email",
        { method: "POST", body: "not json" },
      );

      expect(await gate().isBornFinalizedSignUp({ request })).toBe(false);
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });
});

describe("given a request that is not better-auth's email sign-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEnabled.mockResolvedValue(true);
  });

  it("leaves a sign-in alone", async () => {
    expect(
      await gate().isBornFinalizedSignUp({
        request: signUp(
          { email: "sam@acme.com" },
          "https://app.langwatch.test/api/auth/sign-in/email",
        ),
      }),
    ).toBe(false);
    expect(isEnabled).not.toHaveBeenCalled();
  });

  /**
   * rou3 resolves `/sign-up/email/` to the same handler, so the path is
   * normalized before it is matched — a raw-suffix check would let a
   * one-character variant walk past the allowlist entirely.
   */
  it("still recognises the route with a trailing slash", async () => {
    expect(
      await gate().isBornFinalizedSignUp({
        request: signUp(
          { email: "sam@acme.com" },
          "https://app.langwatch.test/api/auth/sign-up/email/",
        ),
      }),
    ).toBe(true);
  });

  it("leaves a GET alone", async () => {
    const request = new Request(
      "https://app.langwatch.test/api/auth/sign-up/email",
      { method: "GET" },
    );

    expect(await gate().isBornFinalizedSignUp({ request })).toBe(false);
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
