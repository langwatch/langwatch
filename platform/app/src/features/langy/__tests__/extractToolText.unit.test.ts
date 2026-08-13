/**
 * `extractToolText` had no test of its own. It was split into two functions to
 * bring its cognitive complexity under the repo limit, and a refactor of
 * untested code is a guess, so its branches are pinned here first.
 *
 * Every card that renders a tool result reads through this, so the fallbacks
 * are the point: whatever a tool returns, a card shows something rather than
 * `[object Object]`.
 */
import { describe, expect, it } from "vitest";

import { extractToolText } from "../logic/capabilities/capabilityRegistry";

describe("extractToolText", () => {
  describe("given nothing to show", () => {
    it("returns an empty string for null", () => {
      expect(extractToolText(null)).toBe("");
    });

    it("returns an empty string for undefined", () => {
      expect(extractToolText(undefined)).toBe("");
    });
  });

  describe("given a plain string", () => {
    it("passes it through untouched", () => {
      expect(extractToolText("already text")).toBe("already text");
    });

    it("keeps an empty string empty rather than rendering it as JSON", () => {
      expect(extractToolText("")).toBe("");
    });
  });

  describe("given a non-object primitive", () => {
    it("stringifies a number", () => {
      expect(extractToolText(42)).toBe("42");
    });

    it("stringifies a boolean", () => {
      expect(extractToolText(false)).toBe("false");
    });
  });

  describe("given an object carrying its own text", () => {
    it("prefers the text field over rendering the object", () => {
      expect(extractToolText({ text: "the answer", other: 1 })).toBe(
        "the answer",
      );
    });

    it("ignores a text field that is not a string", () => {
      expect(extractToolText({ text: 7 })).toBe('{\n  "text": 7\n}');
    });
  });

  describe("given an MCP content envelope", () => {
    it("joins every text part with newlines, in order", () => {
      const output = {
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
      };

      expect(extractToolText(output)).toBe("first\nsecond");
    });

    it("skips parts that carry no text", () => {
      const output = {
        content: [
          { type: "image", data: "..." },
          { type: "text", text: "only this" },
          null,
        ],
      };

      expect(extractToolText(output)).toBe("only this");
    });

    it("falls through to JSON when every part is textless", () => {
      const output = { content: [{ type: "image", data: "x" }] };

      // Not "": an envelope that said nothing is still worth showing, and the
      // caller cannot tell the two apart from the return value alone.
      expect(extractToolText(output)).toContain('"type": "image"');
    });

    it("falls through to JSON when content is not an array", () => {
      expect(extractToolText({ content: "not-an-array" })).toContain(
        '"content": "not-an-array"',
      );
    });
  });

  describe("given an arbitrary structured value", () => {
    it("renders it as indented JSON", () => {
      expect(extractToolText({ a: 1 })).toBe('{\n  "a": 1\n}');
    });

    it("returns an empty string when the value cannot be serialized", () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      expect(extractToolText(cyclic)).toBe("");
    });
  });
});
