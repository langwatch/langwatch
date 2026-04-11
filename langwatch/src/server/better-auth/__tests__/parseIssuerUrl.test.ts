/**
 * Regression test for iter-22 bug 18: malformed `AUTH0_ISSUER` /
 * `OKTA_ISSUER` (no scheme) was crashing the server at boot with a
 * cryptic native `TypeError: Invalid URL` deep in the Next.js
 * instrumentation hook. The fix wraps the parser in a forgiving helper
 * that auto-prepends `https://` for scheme-less inputs and throws a
 * clear error message for genuinely unparseable input.
 */
import { describe, expect, it } from "vitest";
import { parseIssuerUrl } from "../index";

describe("parseIssuerUrl", () => {
  describe("when given a URL with https scheme", () => {
    it("parses without modification", () => {
      const url = parseIssuerUrl("https://tenant.us.auth0.com/", "AUTH0_ISSUER");
      expect(url.host).toBe("tenant.us.auth0.com");
      expect(url.protocol).toBe("https:");
    });

    it("handles trailing slash and no trailing slash equivalently", () => {
      const a = parseIssuerUrl("https://tenant.us.auth0.com", "AUTH0_ISSUER");
      const b = parseIssuerUrl("https://tenant.us.auth0.com/", "AUTH0_ISSUER");
      expect(a.host).toBe(b.host);
    });
  });

  describe("when given a URL with http scheme", () => {
    it("preserves the http scheme (for local dev / Okta dev tenants)", () => {
      const url = parseIssuerUrl("http://localhost:8080/oauth", "OKTA_ISSUER");
      expect(url.protocol).toBe("http:");
    });
  });

  describe("when given a host without a scheme", () => {
    it("auto-prepends https:// and parses", () => {
      const url = parseIssuerUrl("tenant.us.auth0.com", "AUTH0_ISSUER");
      expect(url.host).toBe("tenant.us.auth0.com");
      expect(url.protocol).toBe("https:");
    });
  });

  describe("when given a genuinely unparseable input", () => {
    it("throws a descriptive error mentioning the env var name", () => {
      expect(() => parseIssuerUrl("not a url at all !!!", "AUTH0_ISSUER")).toThrow(
        /Invalid AUTH0_ISSUER.*not a url at all/,
      );
    });

    it("includes a hint about the expected format", () => {
      expect(() => parseIssuerUrl("@@@", "OKTA_ISSUER")).toThrow(
        /tenant\.us\.auth0\.com/,
      );
    });
  });
});
