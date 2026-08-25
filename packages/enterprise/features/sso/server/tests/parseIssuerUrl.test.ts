// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Regression test for iter-22 bug 18: malformed `auth0Issuer` /
 * `oktaIssuer` (no scheme) was crashing the server at boot with a
 * cryptic native `TypeError: Invalid URL` deep in the Next.js
 * instrumentation hook. The fix wraps the parser in a forgiving helper
 * that auto-prepends `https://` for scheme-less inputs and throws a
 * clear error message for genuinely unparseable input.
 */
import { describe, expect, it } from "vitest";
import { parseIssuerUrl } from "../src/adapters/better-auth.better-auth.adapter";

describe("parseIssuerUrl", () => {
  describe("when given a URL with https scheme", () => {
    it("parses without modification", () => {
      const url = parseIssuerUrl("https://tenant.us.auth0.com/", "auth0Issuer");
      expect(url.host).toBe("tenant.us.auth0.com");
      expect(url.protocol).toBe("https:");
    });

    it("handles trailing slash and no trailing slash equivalently", () => {
      const a = parseIssuerUrl("https://tenant.us.auth0.com", "auth0Issuer");
      const b = parseIssuerUrl("https://tenant.us.auth0.com/", "auth0Issuer");
      expect(a.host).toBe(b.host);
    });
  });

  describe("when given a URL with http scheme", () => {
    it("preserves the http scheme (for local dev / Okta dev tenants)", () => {
      const url = parseIssuerUrl("http://localhost:8080/oauth", "oktaIssuer");
      expect(url.protocol).toBe("http:");
    });
  });

  describe("when given a host without a scheme", () => {
    it("auto-prepends https:// and parses", () => {
      const url = parseIssuerUrl("tenant.us.auth0.com", "auth0Issuer");
      expect(url.host).toBe("tenant.us.auth0.com");
      expect(url.protocol).toBe("https:");
    });
  });

  describe("when given a genuinely unparseable input", () => {
    it("throws a descriptive error mentioning the env var name", () => {
      expect(() => parseIssuerUrl("not a url at all !!!", "auth0Issuer")).toThrow(
        /Invalid auth0Issuer.*not a url at all/,
      );
    });

    it("includes a hint about the expected format", () => {
      expect(() => parseIssuerUrl("@@@", "oktaIssuer")).toThrow(/tenant\.us\.auth0\.com/);
    });
  });
});
