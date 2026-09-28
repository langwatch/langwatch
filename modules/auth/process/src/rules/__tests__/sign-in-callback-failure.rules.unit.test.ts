/** @see specs/identity/sso-signin-error-boundary.feature */
import { describe, expect, it } from "vitest";

import {
  GENERIC_SIGN_IN_ERROR_CODE,
  isSignInCallbackPath,
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
