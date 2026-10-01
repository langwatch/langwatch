/** @see specs/identity/sso-signin-error-boundary.feature */
import { GENERIC_SIGN_IN_ERROR_CODE } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

import {
  isSignInCallbackPath,
  signInErrorRedirectOf,
  signInFailureLocation,
} from "../sign-in-callback-failure.rules.ts";

describe("isSignInCallbackPath", () => {
  describe("when a browser arrives from an identity provider", () => {
    /** @scenario "A sign-in callback that fails on the server lands on the error screen" */
    it.each([
      "/api/auth/callback/microsoft",
      "/api/auth/oauth2/callback/okta",
      "/api/auth/sso/callback/conn_1",
      "/api/auth/sso/saml2/sp/acs/conn_1",
    ])("names %s a callback", (pathname) => {
      expect(isSignInCallbackPath({ pathname })).toBe(true);
    });
  });

  describe("when the app or an API client calls an auth route", () => {
    /** @scenario "A server error on an auth route that is not a callback keeps its status" */
    it.each([
      "/api/auth/sign-in/email",
      "/api/auth/get-session",
      "/api/auth/sso/saml2/sp/metadata",
    ])("does not name %s a callback", (pathname) => {
      expect(isSignInCallbackPath({ pathname })).toBe(false);
    });
  });
});

describe("signInFailureLocation", () => {
  it("carries the generic code and the trace id to the error screen", () => {
    const location = new URL(
      signInFailureLocation({ errorPageUrl: "https://app.test/auth/error", traceId: "trace_1" }),
    );

    expect(location.pathname).toBe("/auth/error");
    expect(location.searchParams.get("error")).toBe(GENERIC_SIGN_IN_ERROR_CODE);
    expect(location.searchParams.get("trace")).toBe("trace_1");
  });
});

describe("signInErrorRedirectOf", () => {
  const errorPageUrl = "https://app.test/auth/error";
  const redirectTo = (location: string) =>
    signInErrorRedirectOf({ status: 302, location, errorPageUrl, traceId: "trace_1" });

  describe("given a sign-in refused with a handled error", () => {
    /** @scenario "A handled refusal crosses with its own code" */
    it.each(["OAuthAccountNotLinked", "account_not_linked", "sso_setup_address_mismatch"])(
      "lets %s cross as it is",
      (code) => {
        expect(redirectTo(`${errorPageUrl}?error=${code}`)).toEqual({ kind: "pass" });
      },
    );
  });

  describe("given a sign-in that failed for a reason we have not written down", () => {
    /** @scenario "An unhandled failure crosses as one generic code" */
    it("sends the generic code with no description, keeping callbackUrl", () => {
      const redirect = redirectTo(
        "/auth/error?error=invalid_code&error_description=token+exchange+failed&callbackUrl=%2Fproj",
      );

      expect(redirect.kind).toBe("withhold");
      if (redirect.kind !== "withhold") return;
      const location = new URL(redirect.location);
      expect(location.searchParams.get("error")).toBe(GENERIC_SIGN_IN_ERROR_CODE);
      expect(location.searchParams.get("error_description")).toBeNull();
      expect(location.searchParams.get("callbackUrl")).toBe("/proj");
    });

    /** @scenario "The cause is written down where we can read it" */
    it("hands back the real cause for the log and the trace id for the screen", () => {
      const redirect = redirectTo(`${errorPageUrl}?error=invalid_code&error_description=boom`);

      expect(redirect).toMatchObject({
        kind: "withhold",
        code: "invalid_code",
        description: "boom",
      });
      if (redirect.kind !== "withhold") return;
      expect(new URL(redirect.location).searchParams.get("trace")).toBe("trace_1");
    });
  });

  describe("given the plugin's native-transaction error", () => {
    /** @scenario "An internal code never travels" */
    it("names no database, adapter or capability in the address", () => {
      const redirect = redirectTo(
        `${errorPageUrl}?error=SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS&error_description=SSO+user+resolution+requires+a+database+adapter+with+native+transaction+support`,
      );

      expect(redirect.kind).toBe("withhold");
      if (redirect.kind !== "withhold") return;
      expect(redirect.location).not.toMatch(/NATIVE_TRANSACTIONS|database|adapter|transaction/i);
    });
  });

  describe("given a redirect that is not to the sign-in error page", () => {
    it.each([
      [302, "https://app.test/projects?error=whatever"],
      [302, "https://elsewhere.test/auth/error?error=whatever"],
      [200, `${errorPageUrl}?error=whatever`],
    ])("leaves a %s to %s alone", (status, location) => {
      expect(signInErrorRedirectOf({ status, location, errorPageUrl, traceId: undefined })).toEqual(
        { kind: "pass" },
      );
    });
  });
});
