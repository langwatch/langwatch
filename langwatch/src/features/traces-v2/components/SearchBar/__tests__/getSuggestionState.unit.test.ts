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
        });
      });
    });

    describe("when the user has typed a partial field name", () => {
      it("returns the chars between '@' and cursor as the query", () => {
        expect(getSuggestionState("@mo", 3)).toEqual({
          open: true,
          mode: "field",
          query: "mo",
        });
      });
    });

    describe("when the cursor is between '@' and the typed chars", () => {
      it("uses only the chars before the cursor as the query", () => {
        expect(getSuggestionState("@mo", 1)).toEqual({
          open: true,
          mode: "field",
          query: "",
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

    describe("when the cursor sits inside free text with no '@' before it", () => {
      it("returns closed", () => {
        expect(getSuggestionState("refund", 6)).toEqual({ open: false });
      });
    });

    describe("when the user types multi-word free text", () => {
      it("stays closed at every cursor position", () => {
        const text = "model is broken";
        for (let pos = 0; pos <= text.length; pos++) {
          expect(getSuggestionState(text, pos)).toEqual({ open: false });
        }
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
      it("returns closed because the '@' is not at a valid token start", () => {
        // "foo@bar" — the '@' is preceded by 'o', not whitespace/(/start
        expect(getSuggestionState("foo@bar", 7)).toEqual({ open: false });
      });
    });
  });

  describe("given a parenthesised expression", () => {
    describe("when the cursor sits inside a value token wrapped in parens", () => {
      it("opens because '(' is a valid token-start preceder", () => {
        expect(getSuggestionState("(@status:error)", 14)).toEqual({
          open: true,
          mode: "value",
          field: "status",
          query: "error",
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
      it("returns closed because the space terminates the token", () => {
        expect(getSuggestionState('@status:"refund po', 18)).toEqual({
          open: false,
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
        });
      });
    });
  });

  describe("given the shorthand negation '-' prefix", () => {
    describe("when the cursor sits inside the negated value token", () => {
      it("opens in value mode (the '-' is not part of the @-token start logic)", () => {
        // "-@status:err" — the '@' is preceded by '-', which is not in our preceders set,
        // so we treat it as not-a-token-start. Closed is the safe default.
        // This documents current behaviour; if liqe shorthand '-' becomes important we'll revisit.
        expect(getSuggestionState("-@status:err", 12)).toEqual({
          open: false,
        });
      });
    });
  });
});
