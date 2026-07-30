import { describe, expect, it } from "vitest";
import { exactModelMatchRegex } from "../modelCostRegex";
import { isSafeRegex } from "../safeRegex";

describe("exactModelMatchRegex", () => {
  describe("when the model name contains regex metacharacters", () => {
    it("escapes dots and slashes so the pattern matches the literal string", () => {
      const pattern = exactModelMatchRegex(
        "bedrock/eu.anthropic.claude-sonnet-4-6",
      );

      expect(pattern).toBe("^bedrock\\/eu\\.anthropic\\.claude-sonnet-4-6$");
      expect(
        new RegExp(pattern).test("bedrock/eu.anthropic.claude-sonnet-4-6"),
      ).toBe(true);
      // The dot must not act as a wildcard.
      expect(
        new RegExp(pattern).test("bedrockXeu.anthropic.claude-sonnet-4-6"),
      ).toBe(false);
    });

    it("anchors the pattern so longer model ids do not match", () => {
      const pattern = exactModelMatchRegex("eu.anthropic.claude-sonnet-4-6");

      expect(
        new RegExp(pattern).test("eu.anthropic.claude-sonnet-4-6-v1:0"),
      ).toBe(false);
      expect(
        new RegExp(pattern).test("xx-eu.anthropic.claude-sonnet-4-6"),
      ).toBe(false);
    });

    it("produces a pattern that passes the shared safety validation", () => {
      expect(
        isSafeRegex(
          exactModelMatchRegex("vertex_ai/gemini-3-pro (preview)+$^"),
        ),
      ).toBe(true);
    });

    it("matches literally even for names full of metacharacters", () => {
      const hostile = "weird+model(v2)[beta]|x*?{1}^$\\end";
      const pattern = exactModelMatchRegex(hostile);

      expect(new RegExp(pattern).test(hostile)).toBe(true);
      expect(new RegExp(pattern).test(hostile + "x")).toBe(false);
    });
  });
});
