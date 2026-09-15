import { describe, expect, it } from "vitest";
import { isAllowedAuthOrigin } from "../originGate";

const BASE = "http://localhost:5571";

describe("isAllowedAuthOrigin", () => {
  describe("given a cross-origin identity-provider form POST", () => {
    it("allows only the exact SAML assertion consumer endpoint", () => {
      expect(
        isAllowedAuthOrigin({
          method: "POST",
          pathname: "/api/auth/sso/saml2/sp/acs/acme",
          origin: "https://idp.example.com",
          referer: undefined,
          baseUrl: BASE,
        }),
      ).toBe(true);

      for (const pathname of [
        "/api/auth/sso/register",
        "/api/auth/sso/callback/acme",
        "/api/auth/sso/saml2/sp/acs/acme/extra",
      ]) {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            pathname,
            origin: "https://idp.example.com",
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(false);
      }
    });

    it("does not exempt GET or another state-changing verb", () => {
      expect(
        isAllowedAuthOrigin({
          method: "PUT",
          pathname: "/api/auth/sso/saml2/sp/acs/acme",
          origin: "https://idp.example.com",
          referer: undefined,
          baseUrl: BASE,
        }),
      ).toBe(false);
    });
  });

  describe("when method is GET / OPTIONS / HEAD", () => {
    /** @scenario "Reading authentication state is never refused for where it came from" */
    it("allows GET requests regardless of origin", () => {
      expect(
        isAllowedAuthOrigin({
          method: "GET",
          origin: "https://evil.example.com",
          referer: undefined,
          baseUrl: BASE,
        }),
      ).toBe(true);
    });

    /** @scenario "Reading authentication state is never refused for where it came from" */
    it("allows OPTIONS preflight from any origin", () => {
      expect(
        isAllowedAuthOrigin({
          method: "OPTIONS",
          origin: "https://evil.example.com",
          referer: undefined,
          baseUrl: BASE,
        }),
      ).toBe(true);
    });

    /** @scenario "Reading authentication state is never refused for where it came from" */
    it("allows HEAD from any origin", () => {
      expect(
        isAllowedAuthOrigin({
          method: "HEAD",
          origin: undefined,
          referer: undefined,
          baseUrl: BASE,
        }),
      ).toBe(true);
    });
  });

  describe("when method is POST / PUT / DELETE / PATCH", () => {
    describe("and Origin header matches baseUrl", () => {
      /** @scenario "A request from this installation's own pages is allowed through" */
      it("allows POST", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: BASE,
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(true);
      });

      /** @scenario "A request from this installation's own pages is allowed through" */
      it("allows PUT", () => {
        expect(
          isAllowedAuthOrigin({
            method: "PUT",
            origin: BASE,
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(true);
      });

      /** @scenario "A request from this installation's own pages is allowed through" */
      it("allows DELETE", () => {
        expect(
          isAllowedAuthOrigin({
            method: "DELETE",
            origin: BASE,
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(true);
      });

      /** @scenario "A request from this installation's own pages is allowed through" */
      it("allows PATCH", () => {
        expect(
          isAllowedAuthOrigin({
            method: "PATCH",
            origin: BASE,
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(true);
      });

      /** @scenario "A request from this installation's own pages is allowed through" */
      it("compares only the origin part, not the full URL with path", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: `${BASE}/some/path?with=query`,
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(true);
      });
    });

    describe("and Origin header is from a different origin", () => {
      /** @scenario "A state-changing auth request from another site is refused" */
      it("rejects requests from a different host", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: "https://evil.example.com",
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(false);
      });

      /** @scenario "A state-changing auth request from another site is refused" */
      it("rejects requests from a subdomain (different origin)", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: "http://attacker.localhost:5571",
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(false);
      });

      /** @scenario "A state-changing auth request from another site is refused" */
      it("rejects requests from a different port", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: "http://localhost:5572",
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(false);
      });

      /** @scenario "A state-changing auth request from another site is refused" */
      it("rejects requests from https when base is http", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: "https://localhost:5571",
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(false);
      });
    });

    describe("and Origin is missing", () => {
      /** @scenario "A browser that names only the page it came from is still recognised" */
      it("falls back to Referer when Referer matches", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: undefined,
            referer: `${BASE}/auth/signin`,
            baseUrl: BASE,
          }),
        ).toBe(true);
      });

      /** @scenario "A state-changing auth request from another site is refused" */
      it("rejects when Referer is from a different origin", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: undefined,
            referer: "https://evil.example.com/page",
            baseUrl: BASE,
          }),
        ).toBe(false);
      });

      /** @scenario "A request that proves no origin at all is refused" */
      it("rejects when both Origin and Referer are missing", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: undefined,
            referer: undefined,
            baseUrl: BASE,
          }),
        ).toBe(false);
      });

      /** @scenario "A request that proves no origin at all is refused" */
      it("rejects when Referer is malformed", () => {
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: undefined,
            referer: "not-a-url",
            baseUrl: BASE,
          }),
        ).toBe(false);
      });
    });

    describe("and Origin is malformed", () => {
      /** @scenario "A browser that names only the page it came from is still recognised" */
      it("falls through to Referer when Origin is garbage", () => {
        // Origin header is present but malformed → originOf returns null →
        // falls through to the Referer fallback path which matches BASE.
        expect(
          isAllowedAuthOrigin({
            method: "POST",
            origin: "garbage",
            referer: BASE,
            baseUrl: BASE,
          }),
        ).toBe(true);
      });
    });
  });

  describe("when baseUrl is malformed", () => {
    /** @scenario "A misconfigured own address refuses every state-changing request rather than none" */
    it("fails closed: rejects all state-changing requests", () => {
      expect(
        isAllowedAuthOrigin({
          method: "POST",
          origin: BASE,
          referer: undefined,
          baseUrl: "not-a-url",
        }),
      ).toBe(false);
    });

    /** @scenario "Reading authentication state is never refused for where it came from" */
    it("still allows GET requests (read-only never gated)", () => {
      expect(
        isAllowedAuthOrigin({
          method: "GET",
          origin: "https://evil.example.com",
          referer: undefined,
          baseUrl: "not-a-url",
        }),
      ).toBe(true);
    });
  });
});
