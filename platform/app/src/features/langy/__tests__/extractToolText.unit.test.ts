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
    describe("when the value is null", () => {
      it("returns an empty string", () => {
        expect(extractToolText(null)).toBe("");
      });
    });

    describe("when the value is undefined", () => {
      it("returns an empty string", () => {
        expect(extractToolText(undefined)).toBe("");
      });
    });
  });

  describe("given a plain string", () => {
    describe("when it has content", () => {
      it("passes it through untouched", () => {
        expect(extractToolText("already text")).toBe("already text");
      });
    });

    describe("when it is empty", () => {
      it("keeps it empty rather than rendering it as JSON", () => {
        expect(extractToolText("")).toBe("");
      });
    });
  });

  describe("given a non-object primitive", () => {
    describe("when it is a number", () => {
      it("stringifies it", () => {
        expect(extractToolText(42)).toBe("42");
      });
    });

    describe("when it is a boolean", () => {
      it("stringifies it", () => {
        expect(extractToolText(false)).toBe("false");
      });
    });
  });

  describe("given an object carrying its own text", () => {
    describe("when the text field is a string", () => {
      it("prefers it over rendering the object", () => {
        expect(extractToolText({ text: "the answer", other: 1 })).toBe(
          "the answer",
        );
      });
    });

    describe("when the text field is not a string", () => {
      it("ignores it and renders the object", () => {
        expect(extractToolText({ text: 7 })).toBe('{\n  "text": 7\n}');
      });
    });
  });

  describe("given an MCP content envelope", () => {
    describe("when every part carries text", () => {
      it("joins them with newlines, in order", () => {
        const output = {
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        };

        expect(extractToolText(output)).toBe("first\nsecond");
      });
    });

    describe("when only some parts carry text", () => {
      it("skips the ones that do not", () => {
        const output = {
          content: [
            { type: "image", data: "..." },
            { type: "text", text: "only this" },
            null,
          ],
        };

        expect(extractToolText(output)).toBe("only this");
      });
    });

    describe("when a part carries text but declares no type", () => {
      it("still reads it, because producers here omit the type", () => {
        // Untyped parts are a real shape in this codebase, not a hypothetical:
        // the trace fixtures carry `content: [{ text: "yo" }]`. Requiring
        // `type === "text"` would render those envelopes as raw JSON.
        const output = { content: [{ text: "untyped but present" }] };

        expect(extractToolText(output)).toBe("untyped but present");
      });
    });

    describe("when no part carries text", () => {
      it("falls through to JSON", () => {
        const output = { content: [{ type: "image", data: "x" }] };

        // Not "": an envelope that said nothing is still worth showing, and the
        // caller cannot tell the two apart from the return value alone.
        expect(extractToolText(output)).toContain('"type": "image"');
      });
    });

    describe("when content is not an array", () => {
      it("falls through to JSON", () => {
        expect(extractToolText({ content: "not-an-array" })).toContain(
          '"content": "not-an-array"',
        );
      });
    });
  });

  describe("given an arbitrary structured value", () => {
    describe("when it serializes", () => {
      it("renders it as indented JSON", () => {
        expect(extractToolText({ a: 1 })).toBe('{\n  "a": 1\n}');
      });
    });

    describe("when serializing throws", () => {
      it("returns an empty string", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;

        expect(extractToolText(cyclic)).toBe("");
      });
    });

    describe("when serializing yields undefined", () => {
      it("returns an empty string rather than undefined", () => {
        // `JSON.stringify` is declared to return `string`, so this escapes the
        // type checker entirely. Every caller then treats the result as a
        // string, and `.match`, `.split` and `.trim` each throw on undefined.
        const output = { toJSON: () => undefined };

        const result = extractToolText(output);

        expect(result).toBe("");
        expect(() => result.split("\n")).not.toThrow();
      });
    });
  });
});
