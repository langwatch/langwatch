/**
 * What a sign-in proves, from better-auth's own endpoint path (D06). An
 * unrecognized path records nothing rather than guessing.
 * Corresponds to specs/identity/mfa-and-session-shape.feature.
 */
import { describe, expect, it } from "vitest";

import { deriveSessionAmr, localFactorsForPath, signInProviderForPath } from "../session-claims.ts";

describe("when a sign-in mints a session", () => {
  it("records the password a credential sign-in proved", () => {
    expect(deriveSessionAmr({ path: "/sign-in/email" })).toEqual(["pwd"]);
    expect(signInProviderForPath({ path: "/sign-in/email" })).toEqual({
      recognized: true,
      provider: "credential",
    });
    expect(signInProviderForPath({ path: "/sign-up/email" })).toEqual({
      recognized: true,
      provider: "credential",
    });
  });

  it("records the password and the code once a challenge is answered", () => {
    expect(deriveSessionAmr({ path: "/two-factor/verify-totp" })).toEqual(["pwd", "otp"]);
    // A backup code is a one-time code by another name: answering differently
    // would make the session list an oracle for which one somebody used.
    expect(deriveSessionAmr({ path: "/two-factor/verify-backup-code" })).toEqual(["pwd", "otp"]);
    expect(signInProviderForPath({ path: "/two-factor/verify-totp" })).toEqual({
      recognized: true,
      provider: "credential",
    });
  });

  it("records a passkey as the phishing-resistant proof it is", () => {
    expect(deriveSessionAmr({ path: "/passkey/verify-authentication" })).toEqual(["phw"]);
    expect(signInProviderForPath({ path: "/passkey/verify-authentication" })).toEqual({
      recognized: true,
      provider: "passkey",
    });
  });

  it("records the factors an identity provider asserted, and no others", () => {
    expect(
      deriveSessionAmr({ path: "/callback/auth0", providerAssertedAmr: ["pwd", "mfa"] }),
    ).toEqual(["oidc", "pwd", "mfa"]);
  });

  it("infers no factor from a provider that asserted none", () => {
    expect(deriveSessionAmr({ path: "/callback/auth0" })).toEqual(["oidc"]);
  });

  it("drops an assertion outside the vocabulary rather than reading it as a factor", () => {
    expect(
      deriveSessionAmr({
        path: "/callback/okta",
        providerAssertedAmr: ["definitely-a-second-factor"],
      }),
    ).toEqual(["oidc"]);
  });

  it("records nothing for a path it does not recognize", () => {
    expect(deriveSessionAmr({ path: "/some/other/endpoint" })).toEqual([]);
    expect(localFactorsForPath({ path: "/some/other/endpoint" })).toEqual([]);
    expect(signInProviderForPath({ path: "/some/other/endpoint" })).toEqual({ recognized: false });
  });
});

describe("given a session minted through a customer's own identity provider", () => {
  it("names the connection the SSO plugin's own callbacks carry", () => {
    // These do not live under `/callback`. Missing them left every such
    // session with no identifier and an empty amr, so the organization's own
    // members were held at a gate their provider could never clear.
    expect(signInProviderForPath({ path: "/sso/callback/ssoc_acme" })).toEqual({
      recognized: true,
      provider: "ssoc_acme",
    });
    expect(signInProviderForPath({ path: "/sso/saml2/sp/acs/ssoc_acme" })).toEqual({
      recognized: true,
      provider: "ssoc_acme",
    });
    expect(deriveSessionAmr({ path: "/sso/callback/ssoc_acme" })).toEqual(["oidc"]);
  });

  it("reads a brokered callback's own provider out of the path", () => {
    expect(signInProviderForPath({ path: "/oauth2/callback/okta?code=abc" })).toEqual({
      recognized: true,
      provider: "okta",
    });
    expect(signInProviderForPath({ path: "/callback/google" })).toEqual({
      recognized: true,
      provider: "google",
    });
  });
});
