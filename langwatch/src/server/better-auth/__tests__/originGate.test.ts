import { describe, it, expect } from "vitest";
import { isAllowedAuthOrigin } from "../originGate";

const BASE = "http://localhost:5571";

describe("isAllowedAuthOrigin", () => {
  describe("when method is GET / OPTIONS / HEAD", () => {
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
