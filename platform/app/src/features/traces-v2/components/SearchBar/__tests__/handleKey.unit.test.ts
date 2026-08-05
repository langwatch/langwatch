import { describe, expect, it } from "vitest";
import { type EditorContext, handleKey, type KeyAction } from "../handleKey";

function ctx(overrides: Partial<EditorContext> = {}): EditorContext {
  return {
    text: "",
    cursorPos: 0,
    suggestion: { open: false },
    highlightedText: null,
    ...overrides,
  };
}

describe("handleKey", () => {
  // ── Enter ────────────────────────────────────────────────────────────────

  describe("given Enter is pressed", () => {
    describe("when the dropdown is closed and there is text", () => {
      it("returns submit with the current text", () => {
        const action = handleKey(
          ctx({ text: "@status:error", cursorPos: 13 }),
          "Enter",
        );
        expect(action).toEqual<KeyAction>({
          kind: "submit",
          text: "@status:error",
        });
      });
    });

    describe("when the dropdown is closed and the text is empty", () => {
      it("returns submit with empty text (clear)", () => {
        const action = handleKey(ctx(), "Enter");
        expect(action).toEqual<KeyAction>({ kind: "submit", text: "" });
      });
    });

    describe("when the dropdown is open in field mode with a highlight", () => {
      it("accepts the highlighted field and reopens in value mode (no @ in replacement)", () => {
        const action = handleKey(
          ctx({
            text: "@stat",
            cursorPos: 5,
            suggestion: {
              open: true,
              mode: "field",
              query: "stat",
              tokenStart: 0,
            },
            highlightedText: "status",
          }),
          "Enter",
        );
        expect(action).toEqual<KeyAction>({
          kind: "accept",
          tokenStart: 0,
          tokenEnd: 5,
          replacement: "status:",
          reopenInValueMode: true,
        });
      });
    });

    describe("when the dropdown is open in value mode with a highlight", () => {
      it("accepts the highlighted value with no @ and a trailing space in replacement", () => {
        const action = handleKey(
          ctx({
            text: "@status:err",
            cursorPos: 11,
            suggestion: {
              open: true,
              mode: "value",
              field: "status",
              query: "err",
              tokenStart: 0,
            },
            highlightedText: "error",
          }),
          "Enter",
        );
        expect(action).toEqual<KeyAction>({
          kind: "accept",
          tokenStart: 0,
          tokenEnd: 11,
          replacement: "status:error\u00A0",
          reopenInValueMode: false,
        });
      });
    });

    describe("when the dropdown is open but has no highlight", () => {
      it("falls back to submit", () => {
        const action = handleKey(
          ctx({
            text: "@xyz",
            cursorPos: 4,
            suggestion: {
              open: true,
              mode: "field",
              query: "xyz",
              tokenStart: 0,
            },
            highlightedText: null,
          }),
          "Enter",
        );
        expect(action).toEqual<KeyAction>({ kind: "submit", text: "@xyz" });
      });
    });

    describe("when the dropdown is open and the active token is preceded by other clauses", () => {
      it("uses the suggestion's tokenStart so only the active token is replaced", () => {
        const action = handleKey(
          ctx({
            text: "@model:gpt-4o AND @stat",
            cursorPos: 23,
            suggestion: {
              open: true,
              mode: "field",
              query: "stat",
              tokenStart: 18,
            },
            highlightedText: "status",
          }),
          "Enter",
        );
        expect(action).toEqual<KeyAction>({
          kind: "accept",
          tokenStart: 18,
          tokenEnd: 23,
          replacement: "status:",
          reopenInValueMode: true,
        });
      });
    });
  });

  // ── Tab ──────────────────────────────────────────────────────────────────

  describe("given Tab is pressed", () => {
    describe("when the dropdown is open with a value highlight", () => {
      it("behaves the same as Enter", () => {
        const enterAction = handleKey(
          ctx({
            text: "@status:err",
            cursorPos: 11,
            suggestion: {
              open: true,
              mode: "value",
              field: "status",
              query: "err",
              tokenStart: 0,
            },
            highlightedText: "error",
          }),
          "Enter",
        );
        const tabAction = handleKey(
          ctx({
            text: "@status:err",
            cursorPos: 11,
            suggestion: {
              open: true,
              mode: "value",
              field: "status",
              query: "err",
              tokenStart: 0,
            },
            highlightedText: "error",
          }),
          "Tab",
        );
        expect(tabAction).toEqual(enterAction);
      });
    });

    describe("when the dropdown is closed", () => {
      it("returns noop so the browser handles default tab behaviour (which blurs)", () => {
        const action = handleKey(
          ctx({ text: "@status:error", cursorPos: 13 }),
          "Tab",
        );
        expect(action).toEqual<KeyAction>({ kind: "noop" });
      });
    });
  });

  // ── Escape ───────────────────────────────────────────────────────────────

  describe("given Escape is pressed", () => {
    describe("when the dropdown is open", () => {
      it("closes the dropdown without losing focus", () => {
        const action = handleKey(
          ctx({
            text: "@stat",
            cursorPos: 5,
            suggestion: {
              open: true,
              mode: "field",
              query: "stat",
              tokenStart: 0,
            },
            highlightedText: "status",
          }),
          "Escape",
        );
        expect(action).toEqual<KeyAction>({ kind: "close-dropdown" });
      });
    });

    describe("when the dropdown is closed", () => {
      it("blurs the editor", () => {
        const action = handleKey(
          ctx({ text: "@status:error", cursorPos: 13 }),
          "Escape",
        );
        expect(action).toEqual<KeyAction>({ kind: "blur" });
      });
    });
  });

  // ── Arrows ───────────────────────────────────────────────────────────────

  describe("given an arrow key is pressed", () => {
    describe("when the dropdown is open", () => {
      it("returns navigate down for ArrowDown", () => {
        const action = handleKey(
          ctx({
            text: "@",
            cursorPos: 1,
            suggestion: {
              open: true,
              mode: "field",
              query: "",
              tokenStart: 0,
            },
            highlightedText: "status",
          }),
          "ArrowDown",
        );
        expect(action).toEqual<KeyAction>({
          kind: "navigate",
          direction: "down",
        });
      });

      it("returns navigate up for ArrowUp", () => {
        const action = handleKey(
          ctx({
            text: "@",
            cursorPos: 1,
            suggestion: {
              open: true,
              mode: "field",
              query: "",
              tokenStart: 0,
            },
            highlightedText: "status",
          }),
          "ArrowUp",
        );
        expect(action).toEqual<KeyAction>({
          kind: "navigate",
          direction: "up",
        });
      });
    });

    describe("when the dropdown is closed", () => {
      it("returns noop for arrow keys (cursor movement is the editor's default)", () => {
        const action = handleKey(
          ctx({ text: "@status:error", cursorPos: 13 }),
          "ArrowDown",
        );
        expect(action).toEqual<KeyAction>({ kind: "noop" });
      });
    });
  });

  // ── Other keys ───────────────────────────────────────────────────────────

  describe("given any other key is pressed", () => {
    describe("when the dropdown is open", () => {
      it("returns noop so the editor handles the keystroke normally", () => {
        const action = handleKey(
          ctx({
            text: "@stat",
            cursorPos: 5,
            suggestion: {
              open: true,
              mode: "field",
              query: "stat",
              tokenStart: 0,
            },
            highlightedText: "status",
          }),
          "a",
        );
        expect(action).toEqual<KeyAction>({ kind: "noop" });
      });
    });

    describe("when the dropdown is closed", () => {
      it("returns noop", () => {
        const action = handleKey(ctx({ text: "x", cursorPos: 1 }), "y");
        expect(action).toEqual<KeyAction>({ kind: "noop" });
      });
    });
  });

  // ── Passive identifier-shape suggestions ────────────────────────────────

  describe("given the dropdown is open from a passive identifier-shape token", () => {
    describe("when Enter is pressed", () => {
      it("accepts the highlighted field — the dropdown is only visible when something matches", () => {
        const action = handleKey(
          ctx({
            text: "stat",
            cursorPos: 4,
            suggestion: {
              open: true,
              mode: "field",
              query: "stat",
              tokenStart: 0,
            },
            highlightedText: "status",
          }),
          "Enter",
        );
        expect(action).toEqual<KeyAction>({
          kind: "accept",
          tokenStart: 0,
          tokenEnd: 4,
          replacement: "status:",
          reopenInValueMode: true,
        });
      });
    });
  });

  // ── Acceptance preserves surrounding text ───────────────────────────────

  describe("given the active token sits between other clauses", () => {
    describe("when the user accepts a value suggestion", () => {
      it("only replaces the token range, leaving surrounding text intact", () => {
        const action = handleKey(
          ctx({
            text: "@model:gpt-4o AND @status:err AND @user:abc",
            cursorPos: 29,
            suggestion: {
              open: true,
              mode: "value",
              field: "status",
              query: "err",
              tokenStart: 18,
            },
            highlightedText: "error",
          }),
          "Enter",
        );
        expect(action).toEqual<KeyAction>({
          kind: "accept",
          tokenStart: 18,
          tokenEnd: 29,
          replacement: "status:error\u00A0",
          reopenInValueMode: false,
        });
      });
    });
  });
});
