/** @see specs/identity/idp-refused-sign-in.feature */
import { describe, expect, it } from "vitest";

import { refusedSignInLocationOf } from "../sign-in-callback-failure.rules.ts";
import {
  extractCallbackSource,
  extractEchoedRoundTrip,
  extractRoundTripValue,
  extractSignInHintCookie,
  extractSignInStartHint,
  extractHintedAddress,
  roundTripBindingOf,
  SIGN_IN_HINT_TTL_MS,
  signInHintSealer,
} from "../sign-in-hint.rules.ts";

const NOW = 1_800_000_000_000;
const hint = { email: "sam@acme.com", providerId: "ssoc_acme", issuedAt: NOW };

describe("signInHintSealer", () => {
  const sealer = signInHintSealer({ secret: "secret-a" });

  describe("when the hint comes back as it was sealed", () => {
    it("opens it", () => {
      expect(sealer.decode({ value: sealer.seal(hint), nowMs: NOW + 1000 })).toEqual(hint);
    });
  });

  describe("when the hint was altered or signed with another key", () => {
    /** @scenario "A forged or tampered hint cookie is ignored" */
    it("opens nothing", () => {
      const sealed = sealer.seal(hint);
      const [payload, signature] = sealed.split(".");
      const forgedPayload = Buffer.from(
        JSON.stringify({ ...hint, email: "ceo@acme.com" }),
      ).toString("base64url");

      expect(sealer.decode({ value: `${forgedPayload}.${signature}`, nowMs: NOW })).toBeUndefined();
      expect(sealer.decode({ value: `${payload}.`, nowMs: NOW })).toBeUndefined();
      expect(sealer.decode({ value: payload!, nowMs: NOW })).toBeUndefined();
      expect(
        signInHintSealer({ secret: "secret-b" }).decode({ value: sealed, nowMs: NOW }),
      ).toBeUndefined();
    });

    /** @scenario "A forged or tampered hint cookie is ignored" */
    it("opens nothing once it has expired", () => {
      const sealed = sealer.seal(hint);

      expect(
        sealer.decode({ value: sealed, nowMs: NOW + SIGN_IN_HINT_TTL_MS + 1 }),
      ).toBeUndefined();
    });
  });

  describe("when the deployment names no secret", () => {
    it("seals nothing and opens nothing", () => {
      const unkeyed = signInHintSealer({ secret: undefined });

      expect(unkeyed.seal(hint)).toBe("");
      expect(unkeyed.decode({ value: sealer.seal(hint), nowMs: NOW })).toBeUndefined();
    });
  });
});

describe("extractSignInStartHint", () => {
  describe("when a sign-in start names a provider and an address", () => {
    /** @scenario "The hint is set when a sign-in starts and dropped once the callback answers" */
    it.each([
      [
        "/api/auth/sign-in/sso",
        { providerId: "ssoc_acme", loginHint: " Sam@Acme.com " },
        "ssoc_acme",
        "connection",
      ],
      [
        "/api/auth/sign-in/sso",
        { providerId: "ssoc_acme", email: "sam@acme.com" },
        "ssoc_acme",
        "connection",
      ],
      [
        "/api/auth/sign-in/social",
        { provider: "google", loginHint: "sam@acme.com" },
        "google",
        "provider",
      ],
      [
        "/api/auth/sign-in/social",
        { provider: "azure-ad", loginHint: "sam@acme.com" },
        "microsoft",
        "provider",
      ],
      [
        "/api/auth/sign-in/oauth2",
        { providerId: "okta", loginHint: "sam@acme.com" },
        "okta",
        "provider",
      ],
    ])("reads %s", (pathname, body, providerId, source) => {
      expect(extractSignInStartHint({ pathname, body })).toEqual({
        providerId,
        source,
        email: "sam@acme.com",
      });
    });
  });

  describe("when the start carries no address", () => {
    /** @scenario "A sign-in that never came back is noticed on the next visit" */
    it.each([
      ["/api/auth/sign-in/sso", { providerId: "ssoc_acme" }, "ssoc_acme", "connection"],
      [
        "/api/auth/sign-in/social",
        { provider: "google", loginHint: "not-an-address" },
        "google",
        "provider",
      ],
    ])("reads the provider alone from %s", (pathname, body, providerId, source) => {
      expect(extractSignInStartHint({ pathname, body })).toEqual({ providerId, source });
    });
  });

  describe("when the start names no provider", () => {
    it.each([
      ["/api/auth/sign-in/email", { email: "sam@acme.com", password: "x" }],
      ["/api/auth/sign-in/sso", { email: "sam@acme.com" }],
    ])("reads nothing from %s", (pathname, body) => {
      expect(extractSignInStartHint({ pathname, body })).toBeUndefined();
    });
  });
});

describe("extractCallbackSource", () => {
  describe("when the path is a provider's callback", () => {
    /** @scenario "A hint for another provider is ignored" */
    it.each([
      ["/api/auth/sso/callback/ssoc_acme", { kind: "connection", connectionId: "ssoc_acme" }],
      ["/api/auth/sso/saml2/sp/acs/ssoc_acme", { kind: "connection", connectionId: "ssoc_acme" }],
      ["/api/auth/oauth2/callback/okta", { kind: "provider", providerId: "okta" }],
      ["/api/auth/callback/google", { kind: "provider", providerId: "google" }],
      ["/api/auth/callback/azure-ad", { kind: "provider", providerId: "microsoft" }],
    ])("names who answered %s", (pathname, expected) => {
      expect(extractCallbackSource({ pathname })).toMatchObject(expected);
    });
  });

  describe("when the path is no callback", () => {
    it("names nobody", () => {
      expect(extractCallbackSource({ pathname: "/api/auth/sign-in/sso" })).toBeUndefined();
      expect(extractCallbackSource({ pathname: "/api/auth/callback/%E0%A4%A" })).toBeUndefined();
    });
  });
});

describe("extractSignInHintCookie", () => {
  it("reads the hint among other cookies", () => {
    expect(extractSignInHintCookie("a=1; langwatch.sign_in_hint=abc.def; b=2")).toBe("abc.def");
    expect(extractSignInHintCookie("a=1")).toBeUndefined();
    expect(extractSignInHintCookie(null)).toBeUndefined();
  });
});

describe("refusedSignInLocationOf", () => {
  const location = "https://app.test/auth/error?error=access_denied&callbackUrl=%2Fp&trace=t_1";

  describe("when the organization would hold the person for a seat", () => {
    /** @scenario "A refused person the organization would hold for a seat sees the seat-limit screen first" */
    it("crosses as seat_limit_reached with the reference and no provider kind", () => {
      const target = new URL(
        refusedSignInLocationOf({
          location,
          verdict: { outcome: "seat_limit", idp: "okta" },
          reference: "ref_1",
        }),
      );

      expect(target.searchParams.get("error")).toBe("seat_limit_reached");
      expect(target.searchParams.get("trace")).toBe("ref_1");
      expect(target.searchParams.has("idp")).toBe(false);
      expect(target.searchParams.get("callbackUrl")).toBe("/p");
    });
  });

  describe("when the provider refused and seats are free", () => {
    /** @scenario "A refused person at an organization with seats free is told the provider refused" */
    it("crosses as access_denied naming the admitted kind", () => {
      const target = new URL(
        refusedSignInLocationOf({
          location,
          verdict: { outcome: "refused", idp: "entra" },
          reference: "ref_1",
        }),
      );

      expect(target.searchParams.get("error")).toBe("access_denied");
      expect(target.searchParams.get("idp")).toBe("entra");
    });
  });

  describe("when no classification is known", () => {
    /** @scenario "A failure classifying the refusal still lands on the plain refusal" */
    it("crosses as the plain refusal with the reference", () => {
      const target = new URL(
        refusedSignInLocationOf({ location, verdict: undefined, reference: "ref_1" }),
      );

      expect(target.searchParams.get("error")).toBe("access_denied");
      expect(target.searchParams.has("idp")).toBe(false);
      expect(target.searchParams.get("trace")).toBe("ref_1");
    });
  });
});

describe("extractRoundTripValue", () => {
  it("reads a SAML start's RelayState", () => {
    expect(
      extractRoundTripValue({ url: "https://idp.acme.test/sso?SAMLRequest=x&RelayState=r1" }),
    ).toBe("r1");
  });

  it("reads an OIDC start's state", () => {
    expect(extractRoundTripValue({ url: "https://idp.acme.test/authorize?state=s1" })).toBe("s1");
  });

  it("reads nothing off a URL without one, or off no URL", () => {
    expect(extractRoundTripValue({ url: "https://idp.acme.test/authorize" })).toBeUndefined();
    expect(extractRoundTripValue({ url: "not a url" })).toBeUndefined();
    expect(extractRoundTripValue({ url: null })).toBeUndefined();
  });
});

describe("extractEchoedRoundTrip", () => {
  it("reads the state on a callback's query", () => {
    expect(
      extractEchoedRoundTrip({
        url: "https://app.test/cb?error=access_denied&state=s1",
        formBody: undefined,
      }),
    ).toBe("s1");
  });

  it("reads the RelayState a provider posted", () => {
    expect(
      extractEchoedRoundTrip({
        url: "https://app.test/acs/c",
        formBody: "SAMLResponse=x&RelayState=r1",
      }),
    ).toBe("r1");
  });

  it("reads nothing from an oversized form", () => {
    const formBody = `RelayState=r1&pad=${"a".repeat(600 * 1024)}`;
    expect(extractEchoedRoundTrip({ url: "https://app.test/acs/c", formBody })).toBeUndefined();
  });
});

describe("extractHintedAddress", () => {
  const bound = { ...hint, binding: roundTripBindingOf({ value: "rt-1" }) };

  /** @scenario "A refusal that does not echo the sign-in's round trip names nobody" */
  it("names the address when the callback echoes the bound round trip", () => {
    expect(
      extractHintedAddress({ hint: bound, providerId: "ssoc_acme", echoedRoundTrip: "rt-1" }),
    ).toBe("sam@acme.com");
  });

  /** @scenario "A refusal that does not echo the sign-in's round trip names nobody" */
  it.each([
    ["another round trip", bound, "ssoc_acme", "rt-2"],
    ["no round trip echoed", bound, "ssoc_acme", undefined],
    ["a hint with no binding", hint, "ssoc_acme", "rt-1"],
    ["another provider", bound, "ssoc_other", "rt-1"],
  ] as const)("names nobody for %s", (_label, given, providerId, echoedRoundTrip) => {
    expect(extractHintedAddress({ hint: given, providerId, echoedRoundTrip })).toBeNull();
  });
});
