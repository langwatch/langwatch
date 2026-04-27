/**
 * Tests for the OAuth profile name fallback logic in src/server/better-auth/index.ts.
 *
 * The original NextAuth config had provider-specific fallbacks:
 *   - GitHub: profile.name ?? profile.login
 *   - GitLab: profile.name ?? profile.username
 *   - Auth0:  profile.name ?? profile.nickname
 *   - Azure:  profile.name ?? profile.displayName
 *
 * `fallbackName()` consolidates those into a single precedence chain that
 * never returns an empty string (BetterAuth's Zod User schema requires
 * `name: string`, non-nullable).
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/server/redis", () => ({ connection: undefined }));
vi.mock("../hooks", () => ({
  beforeUserCreate: vi.fn(),
  afterUserCreate: vi.fn(),
  beforeAccountCreate: vi.fn(),
  beforeSessionCreate: vi.fn(),
  afterSessionCreate: vi.fn(),
}));

import { fallbackName } from "../index";

describe("fallbackName", () => {
  describe("when profile.name is set", () => {
    it("returns name", () => {
      expect(fallbackName({ name: "Alice Smith" })).toBe("Alice Smith");
    });

    it("prefers name over nickname", () => {
      expect(
        fallbackName({ name: "Alice Smith", nickname: "alice" }),
      ).toBe("Alice Smith");
    });

    it("trims whitespace from name", () => {
      expect(fallbackName({ name: "  Alice  " })).toBe("Alice");
    });

    it("ignores empty-string name and falls through", () => {
      expect(fallbackName({ name: "", login: "alice" })).toBe("alice");
    });

    it("ignores whitespace-only name and falls through", () => {
      expect(fallbackName({ name: "   ", nickname: "nick" })).toBe("nick");
    });
  });

  describe("when name is null but nickname is set (Auth0 fallback)", () => {
    it("returns nickname", () => {
      expect(fallbackName({ name: null, nickname: "alice42" })).toBe("alice42");
    });
  });

  describe("when name is null but displayName is set (Azure fallback)", () => {
    it("returns displayName", () => {
      expect(
        fallbackName({ name: null, displayName: "Alice at Corp" }),
      ).toBe("Alice at Corp");
    });
  });

  describe("when name is null but login is set (GitHub fallback)", () => {
    it("returns login", () => {
      expect(fallbackName({ name: null, login: "alice-gh" })).toBe("alice-gh");
    });
  });

  describe("when name is null but username is set (GitLab fallback)", () => {
    it("returns username", () => {
      expect(fallbackName({ name: null, username: "alice-gl" })).toBe(
        "alice-gl",
      );
    });
  });

  describe("when name is null but preferred_username is set (OIDC)", () => {
    it("returns preferred_username", () => {
      expect(
        fallbackName({ name: null, preferred_username: "alice" }),
      ).toBe("alice");
    });
  });

  describe("when only email is set", () => {
    it("returns the email local-part", () => {
      expect(fallbackName({ email: "alice@example.com" })).toBe("alice");
    });

    it("handles multi-dot local parts", () => {
      expect(fallbackName({ email: "alice.smith@example.com" })).toBe(
        "alice.smith",
      );
    });
  });

  describe("when nothing is set", () => {
    it("returns the literal 'User' so BetterAuth doesn't reject", () => {
      expect(fallbackName({})).toBe("User");
    });

    it("returns 'User' for all-null fields", () => {
      expect(
        fallbackName({
          name: null,
          nickname: null,
          login: null,
          username: null,
          displayName: null,
          email: null,
        }),
      ).toBe("User");
    });
  });

  describe("fallback precedence ordering", () => {
    it("respects name > nickname > displayName > login > username > preferred_username > email > 'User'", () => {
      // 8 progressively less specific profiles
      expect(fallbackName({ name: "A", nickname: "B" })).toBe("A");
      expect(fallbackName({ nickname: "B", displayName: "C" })).toBe("B");
      expect(fallbackName({ displayName: "C", login: "D" })).toBe("C");
      expect(fallbackName({ login: "D", username: "E" })).toBe("D");
      expect(fallbackName({ username: "E", preferred_username: "F" })).toBe(
        "E",
      );
      expect(
        fallbackName({
          preferred_username: "F",
          email: "g@example.com",
        }),
      ).toBe("F");
      expect(fallbackName({ email: "g@example.com" })).toBe("g");
      expect(fallbackName({})).toBe("User");
    });
  });
});
