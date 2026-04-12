/**
 * Security tests for the same-origin redirect guard.
 *
 * Invariants:
 *  - Relative paths starting with `/` pass through
 *  - `//evil.com` is NOT a relative path (protocol-relative URL) → rejected
 *  - Absolute same-origin URLs collapse to their path+query+hash
 *  - Cross-origin URLs are replaced with "/"
 *  - Malformed URLs fall back to "/"
 *  - Dangerous schemes (javascript:, data:) are rejected
 */

import { describe, expect, it, vi } from "vitest";

// Stub out the better-auth client so the module can load without network.
vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: false, refetch: vi.fn() }),
    signIn: {
      email: vi.fn().mockResolvedValue({ error: null }),
      social: vi.fn().mockResolvedValue({ error: null }),
    },
    signOut: vi.fn().mockResolvedValue({}),
    getSession: vi.fn().mockResolvedValue({ data: null }),
  }),
}));

import { safeRedirectTarget } from "../auth-client";

const ORIGIN = "https://app.example.com";

describe("safeRedirectTarget", () => {
  describe("when the callbackUrl is a relative path", () => {
    it("allows a simple relative path", () => {
      expect(safeRedirectTarget("/dashboard", ORIGIN)).toBe("/dashboard");
    });

    it("allows nested paths with query and hash", () => {
      expect(
        safeRedirectTarget("/dashboard?org=acme#section", ORIGIN),
      ).toBe("/dashboard?org=acme#section");
    });
  });

  describe("when the callbackUrl is a protocol-relative URL (//evil.com)", () => {
    it("blocks the redirect and falls back to /", () => {
      expect(safeRedirectTarget("//evil.com/steal", ORIGIN)).toBe("/");
    });
  });

  describe("when the callbackUrl is a cross-origin absolute URL", () => {
    it("blocks https://evil.com", () => {
      expect(safeRedirectTarget("https://evil.com/phish", ORIGIN)).toBe("/");
    });

    it("blocks http:// downgrade attacks", () => {
      expect(safeRedirectTarget("http://evil.com/", ORIGIN)).toBe("/");
    });

    it("blocks a subdomain of the same root domain", () => {
      expect(
        safeRedirectTarget("https://evil.app.example.com/", ORIGIN),
      ).toBe("/");
    });
  });

  describe("when the callbackUrl is the app's own origin", () => {
    it("collapses to just the path+query+hash", () => {
      expect(
        safeRedirectTarget(`${ORIGIN}/settings?tab=general#auth`, ORIGIN),
      ).toBe("/settings?tab=general#auth");
    });

    it("handles just the origin as /", () => {
      expect(safeRedirectTarget(ORIGIN, ORIGIN)).toBe("/");
    });
  });

  describe("when the callbackUrl is undefined or empty", () => {
    it("returns / for undefined", () => {
      expect(safeRedirectTarget(undefined, ORIGIN)).toBe("/");
    });

    it("returns / for empty string", () => {
      expect(safeRedirectTarget("", ORIGIN)).toBe("/");
    });
  });

  describe("when the callbackUrl is a bare word", () => {
    it("treats it as a same-origin relative path (URL() resolves it)", () => {
      // "not a url at all" resolves against ORIGIN to
      // https://app.example.com/not%20a%20url%20at%20all, which is same-origin
      // and therefore safe to redirect to.
      expect(safeRedirectTarget("not a url at all", ORIGIN)).toBe(
        "/not%20a%20url%20at%20all",
      );
    });
  });

  describe("when the callbackUrl uses a dangerous scheme", () => {
    it("blocks javascript: URLs", () => {
      expect(safeRedirectTarget("javascript:alert(1)", ORIGIN)).toBe("/");
    });

    it("blocks data: URLs", () => {
      expect(
        safeRedirectTarget(
          "data:text/html,<script>alert(1)</script>",
          ORIGIN,
        ),
      ).toBe("/");
    });

    it("blocks file: URLs", () => {
      expect(safeRedirectTarget("file:///etc/passwd", ORIGIN)).toBe("/");
    });
  });
});
