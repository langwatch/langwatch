// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";
import {
  isCredentialMutationPath,
  isEmailAuthPath,
  isGateDependentPath,
  isGatedSsoPath,
  isPasswordResetPath,
  normalizedRequestPathname,
  requestPathname,
} from "../src/sso-path-gate";

const host = "https://app.example.com/api/auth";

describe("normalizedRequestPathname", () => {
  describe("given a URL with a query string and trailing slashes", () => {
    it("strips both so the router's canonical form is matched", () => {
      expect(normalizedRequestPathname(`${host}/sign-up/email/?x=1`)).toBe(
        "/api/auth/sign-up/email",
      );
      expect(normalizedRequestPathname(`${host}/sign-up/email//`)).toBe(
        "/api/auth/sign-up/email",
      );
    });
  });

  describe("given a non-absolute URL (defensive fallback)", () => {
    it("falls back to a query-stripped split", () => {
      expect(normalizedRequestPathname("/sign-in/social?code=abc")).toBe(
        "/sign-in/social",
      );
    });
  });
});

describe("requestPathname", () => {
  describe("given a callback URL carrying a trailing slash and a query", () => {
    it("keeps the trailing slash the callback matcher relies on", () => {
      expect(requestPathname(`${host}/oauth2/callback/okta/?code=x`)).toBe(
        "/api/auth/oauth2/callback/okta/",
      );
    });
  });
});

describe("isEmailAuthPath", () => {
  describe("given the email sign-in and sign-up endpoints", () => {
    it("matches them, trailing slash included, and nothing else", () => {
      expect(
        isEmailAuthPath(normalizedRequestPathname(`${host}/sign-in/email/`)),
      ).toBe(true);
      expect(
        isEmailAuthPath(normalizedRequestPathname(`${host}/sign-up/email`)),
      ).toBe(true);
      expect(
        isEmailAuthPath(normalizedRequestPathname(`${host}/get-session`)),
      ).toBe(false);
    });
  });
});

describe("isCredentialMutationPath", () => {
  describe("given the always-blocked mutation routes and the reset pair", () => {
    it("matches the mutation routes but not the reset pair", () => {
      expect(
        isCredentialMutationPath(
          normalizedRequestPathname(`${host}/set-password`),
        ),
      ).toBe(true);
      expect(
        isCredentialMutationPath(
          normalizedRequestPathname(`${host}/request-password-reset`),
        ),
      ).toBe(false);
    });
  });
});

describe("isPasswordResetPath", () => {
  describe("given the reset pair and a neighbouring credential route", () => {
    it("matches only the reset pair", () => {
      expect(
        isPasswordResetPath(
          normalizedRequestPathname(`${host}/request-password-reset`),
        ),
      ).toBe(true);
      expect(
        isPasswordResetPath(
          normalizedRequestPathname(`${host}/reset-password?token=x`),
        ),
      ).toBe(true);
      expect(
        isPasswordResetPath(normalizedRequestPathname(`${host}/set-password`)),
      ).toBe(false);
    });
  });
});

describe("isGatedSsoPath", () => {
  describe("given an SSO-initiation or link route", () => {
    it("matches, including trailing-slash and query variants", () => {
      for (const path of [
        "/sign-in/social",
        "/sign-in/oauth2/",
        "/link-social?provider=github",
        "/oauth2/link",
      ]) {
        expect(isGatedSsoPath(`${host}${path}`)).toBe(true);
      }
    });
  });

  describe("given any callback route (incl. the legacy rewrite)", () => {
    it("matches by pathname prefix regardless of query or provider segment", () => {
      expect(isGatedSsoPath(`${host}/callback/auth0?code=abc&state=xyz`)).toBe(
        true,
      );
      expect(isGatedSsoPath(`${host}/oauth2/callback/okta?code=abc`)).toBe(
        true,
      );
    });
  });

  describe("given the phantom /oauth2/authorize or an unrelated route", () => {
    it("does not match", () => {
      expect(isGatedSsoPath(`${host}/oauth2/authorize`)).toBe(false);
      expect(isGatedSsoPath(`${host}/get-session`)).toBe(false);
      expect(isGatedSsoPath(`${host}/sign-in/email`)).toBe(false);
    });
  });

  describe("given an account route that merely ends in the word callback", () => {
    it("does not match, with or without a trailing slash", () => {
      expect(isGatedSsoPath(`${host}/delete-user/callback`)).toBe(false);
      expect(isGatedSsoPath(`${host}/delete-user/callback/?token=x`)).toBe(
        false,
      );
    });
  });
});

describe("isGateDependentPath", () => {
  describe("given a route the gate can refuse in one state or the other", () => {
    it("matches the reset pair, the email-auth pair and the SSO set", () => {
      for (const path of [
        "/request-password-reset",
        "/reset-password",
        "/sign-in/email",
        "/sign-up/email",
        "/sign-in/social",
        "/sign-in/oauth2",
        "/link-social",
        "/oauth2/link",
        "/callback/auth0?code=abc",
        "/oauth2/callback/okta?code=abc",
      ]) {
        expect(isGateDependentPath(`${host}${path}`)).toBe(true);
      }
    });
  });

  describe("given session, account or health traffic", () => {
    it("does not match, so those never wait on the licensing store", () => {
      for (const path of [
        "/get-session",
        "/sign-out",
        "/list-sessions",
        "/revoke-session",
        "/revoke-sessions",
        "/revoke-other-sessions",
        "/update-user",
        "/list-accounts",
        "/account-info",
        "/delete-user",
        "/delete-user/callback",
        "/ok",
      ]) {
        expect(isGateDependentPath(`${host}${path}`)).toBe(false);
      }
    });
  });
});
