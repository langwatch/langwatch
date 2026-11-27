/**
 * @vitest-environment node
 * Which SSO refusals an administrator is told about, and what they are told.
 */
import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";

import { findSsoDiscoveryRefusals } from "../sso-discovery-refusal.rules.ts";

const BASE = "https://app.langwatch.test/api/auth";
const UNTRUSTED = 'The token_endpoint "https://oauth2.acmeapis.test/token" is not trusted.';

const callbackRedirect = (location: string) =>
  new APIError("FOUND", undefined, new Headers({ location }));

describe("findSsoDiscoveryRefusals", () => {
  describe("when the sign-in start is refused with a discovery code", () => {
    /** @scenario "A refused single sign-on start is recorded for whoever runs the installation" */
    it("names the connection, the code and the reason", () => {
      expect(
        findSsoDiscoveryRefusals({
          url: `${BASE}/sign-in/sso`,
          body: { providerId: "connection_1", callbackURL: "/" },
          returned: APIError.from("BAD_REQUEST", {
            code: "discovery_untrusted_origin",
            message: UNTRUSTED,
          }),
        }),
      ).toEqual([
        {
          path: "/api/auth/sign-in/sso",
          code: "discovery_untrusted_origin",
          reason: UNTRUSTED,
          providerId: "connection_1",
          domain: undefined,
        },
      ]);
    });

    it("names the domain of the address typed, not the address", () => {
      expect(
        findSsoDiscoveryRefusals({
          url: `${BASE}/sign-in/sso`,
          body: { email: "sam@acme.test" },
          returned: APIError.from("BAD_REQUEST", { code: "discovery_timeout", message: "slow" }),
        }),
      ).toMatchObject([{ code: "discovery_timeout", domain: "acme.test", providerId: undefined }]);
    });

    it("matches the path with a trailing slash", () => {
      expect(
        findSsoDiscoveryRefusals({
          url: `${BASE}/sign-in/sso/`,
          body: { providerId: "connection_1" },
          returned: APIError.from("BAD_REQUEST", { code: "discovery_timeout", message: "slow" }),
        }),
      ).toMatchObject([{ path: "/api/auth/sign-in/sso", code: "discovery_timeout" }]);
    });

    it("reads the code off a bare { code } refusal", () => {
      expect(
        findSsoDiscoveryRefusals({
          url: `${BASE}/sign-in/sso`,
          body: { providerId: "connection_1" },
          returned: { code: "discovery_private_host" },
        }),
      ).toEqual([
        {
          path: "/api/auth/sign-in/sso",
          code: "discovery_private_host",
          reason: undefined,
          providerId: "connection_1",
          domain: undefined,
        },
      ]);
    });
  });

  describe("when the sign-in start is refused for another reason", () => {
    it("is not a discovery refusal", () => {
      expect(
        findSsoDiscoveryRefusals({
          url: `${BASE}/sign-in/sso`,
          body: { providerId: "connection_1" },
          returned: APIError.from("NOT_FOUND", { code: "PROVIDER_NOT_FOUND", message: "none" }),
        }),
      ).toEqual([]);
    });
  });

  describe("when the OIDC callback redirects with discovery_failed", () => {
    it("names the connection from the path and the reason from the redirect", () => {
      expect(
        findSsoDiscoveryRefusals({
          url: `${BASE}/sso/callback/connection_1?code=abc&state=xyz`,
          body: undefined,
          returned: callbackRedirect(
            "https://app.langwatch.test/auth/error?error=discovery_failed&error_description=unexpected_discovery_error",
          ),
        }),
      ).toEqual([
        {
          path: "/api/auth/sso/callback/connection_1",
          code: "discovery_failed",
          reason: "unexpected_discovery_error",
          providerId: "connection_1",
        },
      ]);
    });
  });

  describe("when the OIDC callback redirects for any other reason", () => {
    it("is not a discovery refusal", () => {
      expect(
        findSsoDiscoveryRefusals({
          url: `${BASE}/sso/callback/connection_1`,
          body: undefined,
          returned: callbackRedirect("https://app.langwatch.test/me"),
        }),
      ).toEqual([]);
    });
  });
});
