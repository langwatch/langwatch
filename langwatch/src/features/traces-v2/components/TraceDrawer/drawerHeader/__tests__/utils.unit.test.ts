/**
 * The drawer header reads its token figures out of the trace's flat attribute
 * map, where every value is a string and a key may simply be absent. Which key
 * wins, and what "absent" means, is the part that decides whether a pill shows
 * at all, so it is pinned here rather than left to the 1,300-line component.
 */
import { describe, expect, it } from "vitest";
import { readNumberAttribute } from "../utils";

describe("readNumberAttribute", () => {
  describe("given the trace carries the key", () => {
    it("parses the stringified number the fold wrote", () => {
      expect(
        readNumberAttribute(
          { "langwatch.reserved.context_size_tokens": "36297" },
          "langwatch.reserved.context_size_tokens",
        ),
      ).toBe(36297);
    });
  });

  describe("given several keys are offered", () => {
    it("takes the first one present, so a reserved sum beats the raw per-span key", () => {
      expect(
        readNumberAttribute(
          { "gen_ai.usage.cache_read.input_tokens": "10" },
          "langwatch.reserved.cache_read_tokens",
          "gen_ai.usage.cache_read.input_tokens",
        ),
      ).toBe(10);
    });

    it("prefers the reserved sum when both are present", () => {
      expect(
        readNumberAttribute(
          {
            "langwatch.reserved.cache_read_tokens": "54740",
            "gen_ai.usage.cache_read.input_tokens": "10",
          },
          "langwatch.reserved.cache_read_tokens",
          "gen_ai.usage.cache_read.input_tokens",
        ),
      ).toBe(54740);
    });
  });

  describe("given the trace does not carry the key", () => {
    it("returns null rather than zero, which a caller would render as a real reading", () => {
      expect(
        readNumberAttribute({}, "langwatch.reserved.context_size_tokens"),
      ).toBeNull();
    });

    it("skips a value that is not a number and keeps looking", () => {
      expect(readNumberAttribute({ a: "not-a-number", b: "7" }, "a", "b")).toBe(
        7,
      );
    });
  });
});
