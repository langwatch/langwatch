import { describe, expect, it } from "vitest";

import { replayHistoryPageInputSchema, replayHistoryPageSchema } from "../index.ts";

describe("the replay history page contract", () => {
  describe("given the page request", () => {
    it("asks for the first page of twenty when it names neither cursor nor limit", () => {
      expect(replayHistoryPageInputSchema.parse({})).toEqual({ limit: 20 });
    });

    it("carries the cursor and limit it names", () => {
      expect(replayHistoryPageInputSchema.parse({ cursor: "run_1", limit: 5 })).toEqual({
        cursor: "run_1",
        limit: 5,
      });
    });

    it.each([
      ["an empty cursor", { cursor: "" }],
      ["a limit of zero", { limit: 0 }],
      ["a limit past the retained fifty", { limit: 51 }],
      ["a fractional limit", { limit: 2.5 }],
    ])("refuses %s", (_name, input) => {
      expect(replayHistoryPageInputSchema.validate(input)).toBe(false);
    });
  });

  describe("given the page answer", () => {
    it("accepts a page and the expiry outcome", () => {
      expect(
        replayHistoryPageSchema.validate({
          outcome: "page",
          entries: [],
          hasMore: false,
          nextCursor: null,
        }),
      ).toBe(true);
      expect(replayHistoryPageSchema.validate({ outcome: "cursor_expired" })).toBe(true);
    });

    it("refuses an outcome it does not declare", () => {
      expect(replayHistoryPageSchema.validate({ outcome: "restart" })).toBe(false);
    });
  });
});
