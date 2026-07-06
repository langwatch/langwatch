import { describe, expect, it } from "vitest";
import {
  isCredentialMutationPath,
  isEmailAuthPath,
  isGatedSsoPath,
  isPasswordResetPath,
  normalizedRequestPathname,
  requestPathname,
} from "../ssoPathGate";

const host = "https://app.example.com/api/auth";

describe("ssoPathGate (ADR-027 pure path predicates)", () => {
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
    it("keeps the trailing slash the callback matcher relies on", () => {
      expect(requestPathname(`${host}/oauth2/callback/okta/?code=x`)).toBe(
        "/api/auth/oauth2/callback/okta/",
      );
    });
  });

  describe("isEmailAuthPath", () => {
    it("matches the email sign-in/up endpoints, trailing slash included", () => {
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

  describe("isCredentialMutationPath", () => {
    it("matches the always-blocked mutation routes but not the reset pair", () => {
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

  describe("isPasswordResetPath", () => {
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
        expect(
          isGatedSsoPath(`${host}/callback/auth0?code=abc&state=xyz`),
        ).toBe(true);
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
  });
});
