import { describe, expect, it } from "vitest";
import { getSpanBarColor } from "../types";

describe("getSpanBarColor", () => {
  // Callers pass a SiblingGroup's shared type/name the same way they pass a
  // single span's — the function has no notion of "span" vs "group" — so
  // this is the one case to cover; GroupRow.integration.test.tsx covers the
  // actual fold-path wiring instead of a second call with identical args.
  describe("given a Skill tool_use span", () => {
    it("returns the purple skill accent regardless of its type", () => {
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
