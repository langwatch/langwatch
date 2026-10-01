/**
 * The `say` tool's words: what the panel draws as reply prose, and what the
 * silent-turn backstop counts as having been said.
 */
import { describe, expect, it } from "vitest";

import { SAY_TOOL, sayEntryText } from "../langy-say-tool.rules.ts";

const sayEntry = (text: unknown) =>
  ({ type: "tool", id: "t1", name: SAY_TOOL, phase: "end", input: { text } }) as const;

describe("sayEntryText", () => {
  describe("given a say entry", () => {
    it("answers the words it carries", () => {
      expect(sayEntryText(sayEntry("Looking at the failing traces now."))).toBe(
        "Looking at the failing traces now.",
      );
    });

    it("answers nothing for a blank line, so whitespace is not a reply", () => {
      expect(sayEntryText(sayEntry("   "))).toBe("");
      expect(sayEntryText(sayEntry(undefined))).toBe("");
      expect(sayEntryText(sayEntry(42))).toBe("");
    });
  });

  describe("given any other entry", () => {
    it("answers nothing", () => {
      expect(sayEntryText({ type: "delta", text: "hello" })).toBe("");
      expect(
        sayEntryText({ type: "tool", id: "t2", name: "bash", phase: "end", input: { text: "hi" } }),
      ).toBe("");
    });
  });
});
