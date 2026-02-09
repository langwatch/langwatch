import { describe, expect, it } from "vitest";
import { buildInviteUrl } from "../buildInviteUrl";

describe("buildInviteUrl()", () => {
  describe("when given an origin and inviteCode", () => {
    it("returns the full invite accept URL", () => {
      const result = buildInviteUrl({
        origin: "https://app.langwatch.ai",
        inviteCode: "abc123",
      });

      expect(result).toBe(
        "https://app.langwatch.ai/invite/accept?inviteCode=abc123"
      );
    });
  });

  describe("when origin has no trailing slash", () => {
    it("constructs the URL correctly", () => {
      const result = buildInviteUrl({
        origin: "http://localhost:3000",
        inviteCode: "xyz789",
      });

      expect(result).toBe(
        "http://localhost:3000/invite/accept?inviteCode=xyz789"
      );
    });
  });

  describe("when origin has trailing slashes", () => {
    it("normalizes origin before constructing the URL", () => {
      const result = buildInviteUrl({
        origin: "https://app.langwatch.ai///",
        inviteCode: "xyz789",
      });

      expect(result).toBe(
        "https://app.langwatch.ai/invite/accept?inviteCode=xyz789"
      );
    });
  });

  describe("when origin is an empty string", () => {
    it("returns a relative invite URL", () => {
      const result = buildInviteUrl({
        origin: "",
        inviteCode: "code42",
      });

      expect(result).toBe("/invite/accept?inviteCode=code42");
    });
  });
});
