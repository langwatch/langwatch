import { describe, expect, it } from "vitest";
import { getSpanBarColor } from "../types";

describe("getSpanBarColor", () => {
  describe("given a Skill tool_use span", () => {
    it("returns the purple skill accent regardless of its type", () => {
      expect(getSpanBarColor("tool", "Skill")).toBe("purple.solid");
    });
  });

  describe("given a folded group of Skill spans", () => {
    it("keeps the purple skill accent for the group bar", () => {
      expect(getSpanBarColor("tool", "Skill")).toBe("purple.solid");
    });
  });

  describe("given an ordinary tool span", () => {
    it("falls back to the type's own color", () => {
      expect(getSpanBarColor("tool", "Bash")).toBe("green.solid");
    });
  });

  describe("given an llm span", () => {
    it("uses the llm color, not the skill accent", () => {
      expect(getSpanBarColor("llm", "claude_code.llm")).toBe("blue.solid");
    });
  });

  describe("given a span with no recognized type", () => {
    it("falls back to gray", () => {
      expect(getSpanBarColor(null, "anything")).toBe("gray.solid");
    });
  });
});
