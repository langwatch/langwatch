import { describe, expect, it } from "vitest";
import { getSuggestionState } from "../getSuggestionState";

describe("getSuggestionState", () => {
  describe("given an empty editor", () => {
    describe("when the cursor is at position 0", () => {
      it("returns closed", () => {
        expect(getSuggestionState("", 0)).toEqual({ open: false });
      });
    });
  });

  describe("given the cursor is inside a field-name token", () => {
    describe("when the text is just '@' and cursor sits after it", () => {
      it("opens the dropdown in field mode with empty query", () => {
        expect(getSuggestionState("@", 1)).toEqual({
          open: true,
          mode: "field",
          query: "",
          tokenStart: 0,
        });
      });
    });

    describe("when the user has typed a partial field name", () => {
      it("returns the chars between '@' and cursor as the query", () => {
        expect(getSuggestionState("@mo", 3)).toEqual({
          open: true,
          mode: "field",
          query: "mo",
          tokenStart: 0,
        });
      });
    });

    describe("when the cursor is between '@' and the typed chars", () => {
      it("uses only the chars before the cursor as the query", () => {
        expect(getSuggestionState("@mo", 1)).toEqual({
          open: true,
          mode: "field",
          query: "",
          tokenStart: 0,
        });
      });
    });
  });

  describe("given the cursor is inside a value token", () => {
    describe("when the text is '@field:' with cursor after the colon", () => {
      it("opens the dropdown in value mode with empty query", () => {
        expect(getSuggestionState("@model:", 7)).toEqual({
          open: true,
          mode: "value",
          field: "model",
          query: "",
          tokenStart: 0,
        });
      });
    });

    describe("when the user has typed a partial value", () => {
      it("returns the chars between ':' and cursor as the query", () => {
        expect(getSuggestionState("@model:gpt", 10)).toEqual({
          open: true,
          mode: "value",
          field: "model",
          query: "gpt",
          tokenStart: 0,
        });
      });
    });

    describe("when there is no leading sigil (post-accept state)", () => {
      it("still opens value mode so reopen-after-accept works", () => {
        expect(getSuggestionState("model:gpt", 9)).toEqual({
          open: true,
          mode: "value",
          field: "model",
          query: "gpt",
          tokenStart: 0,
        });
      });
    });
  });

  describe("given the cursor has moved past the token", () => {
    describe("when there is a trailing space and cursor sits after it", () => {
      it("returns closed", () => {
        expect(getSuggestionState("@model:gpt-4o ", 14)).toEqual({
          open: false,
        });
      });
    });

    describe("when the cursor sits inside an identifier-shape word with no '@' before it", () => {
      it("opens passive field-mode autocomplete", () => {
        // Passive suggestions are filtered to known fields by `getSuggestionItems`,
        // so the dropdown only renders when at least one field name matches.
        expect(getSuggestionState("refund", 6)).toEqual({
          open: true,
          mode: "field",
          query: "refund",
          tokenStart: 0,
        });
      });
    });

    describe("when the user types multi-word free text", () => {
      it("opens at each identifier-shape word but closes at the spaces", () => {
        const text = "model is broken";
        // pos 0: empty token, closed.
        expect(getSuggestionState(text, 0)).toEqual({ open: false });
        // pos 1-5: typing "model" — open with growing query.
        for (let pos = 1; pos <= 5; pos++) {
          expect(getSuggestionState(text, pos)).toMatchObject({
            open: true,
            mode: "field",
          });
        }
        // pos 6: cursor right after the space — empty token, closed.
        expect(getSuggestionState(text, 6)).toEqual({ open: false });
      });
    });
  });

  describe("given multiple clauses in the query", () => {
    describe("when the cursor sits inside a later @-token", () => {
      it("opens for that token only", () => {
        expect(getSuggestionState("@status:error AND @mo", 21)).toEqual({
          open: true,
          mode: "field",
          query: "mo",
          tokenStart: 18,
        });
      });
    });

    describe("when the cursor sits at the end of an earlier value with no whitespace yet", () => {
      it("opens in value mode for the earlier field", () => {
        expect(getSuggestionState("@status:error AND @mo", 13)).toEqual({
          open: true,
          mode: "value",
          field: "status",
          query: "error",
          tokenStart: 0,
        });
      });
    });

    describe("when the cursor sits in the whitespace between clauses", () => {
      it("returns closed", () => {
        expect(getSuggestionState("@status:error AND @mo", 14)).toEqual({
          open: false,
        });
      });
    });

    describe("when the cursor sits inside a later @-token but the @ immediately follows another token char (no space)", () => {
      it("returns closed because the active token has no field/sigil shape", () => {
        // "foo@bar" — no separator before the @, so the active token is "foo@bar".
        // The token doesn't start with `@`, has no `:`, and contains a non-identifier
        // char, so the dropdown stays closed.
        expect(getSuggestionState("foo@bar", 7)).toEqual({ open: false });
      });
    });
  });

  describe("given a parenthesised expression", () => {
    describe("when the cursor sits inside a value token wrapped in parens", () => {
      it("opens because '(' acts as a token boundary", () => {
        expect(getSuggestionState("(@status:error)", 14)).toEqual({
          open: true,
          mode: "value",
          field: "status",
          query: "error",
          tokenStart: 1,
        });
      });
    });

    describe("when the cursor sits after the closing paren", () => {
      it("returns closed", () => {
        expect(getSuggestionState("(@status:error)", 15)).toEqual({
          open: false,
        });
      });
    });
  });

  describe("given a quoted value", () => {
    describe("when the cursor sits inside the quoted value before any whitespace", () => {
      it("returns closed because quoted values are not autocompleted", () => {
        expect(getSuggestionState('@status:"refu', 13)).toEqual({
          open: false,
        });
      });
    });

    describe("when the cursor sits inside a quoted value after a space inside the quotes", () => {
      it("opens passive field-mode for the post-space identifier (the active token is no longer the quoted value)", () => {
        // The space terminates the value-mode token, leaving "po" as the new
        // active word. Identifier-shape, so passive autocomplete opens —
        // dropdown is invisible if no fields prefix-match.
        expect(getSuggestionState('@status:"refund po', 18)).toEqual({
          open: true,
          mode: "field",
          query: "po",
          tokenStart: 16,
        });
      });
    });
  });

  describe("given the cursor sits exactly on the '@' character", () => {
    describe("when the cursor is before the '@'", () => {
      it("returns closed because the @ has not been entered yet from cursor's perspective", () => {
        expect(getSuggestionState("@model", 0)).toEqual({ open: false });
      });
    });
  });

  describe("given the negation prefix 'NOT '", () => {
    describe("when the cursor sits inside the negated field token", () => {
      it("opens for the field after '@' regardless of preceding 'NOT '", () => {
        expect(getSuggestionState("NOT @stat", 9)).toEqual({
          open: true,
          mode: "field",
          query: "stat",
          tokenStart: 4,
        });
      });
    });
  });

  describe("given the shorthand negation '-' prefix", () => {
    describe("when the cursor sits inside a negated value token with sigil", () => {
      it("opens in value mode and preserves the `-` prefix in the editor", () => {
        // tokenStart points after the `-` so accepting only replaces from `@…`
        // onward, leaving the negation prefix intact.
        expect(getSuggestionState("-@status:err", 12)).toEqual({
          open: true,
          mode: "value",
          field: "status",
          query: "err",
          tokenStart: 1,
        });
      });
    });

    describe("when the cursor sits inside a negated value token without sigil", () => {
      it("opens in value mode for the post-accept state", () => {
        expect(getSuggestionState("-status:err", 11)).toEqual({
          open: true,
          mode: "value",
          field: "status",
          query: "err",
          tokenStart: 1,
        });
      });
    });
  });
});
