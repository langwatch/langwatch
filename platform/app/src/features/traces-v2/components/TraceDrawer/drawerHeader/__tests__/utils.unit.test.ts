/**
 * The drawer header reads its token figures out of the trace's flat attribute
 * map, where every value is a string and a key may simply be absent. Which key
 * wins, and what "absent" means, is the part that decides whether a pill shows
 * at all, so it is pinned here rather than left to the 1,300-line component.
 */
import { describe, expect, it } from "vitest";
import { readNumberAttribute } from "../utils";

const RESERVED_SUM = "langwatch.reserved.cache_read_tokens";
const RAW_PER_SPAN = "gen_ai.usage.cache_read.input_tokens";

describe("readNumberAttribute", () => {
  describe("given the attribute map carries the key", () => {
    describe("when one key is requested", () => {
      it("parses the stringified number the fold wrote", () => {
        expect(
          readNumberAttribute(
            { "langwatch.reserved.context_size_tokens": "36297" },
            "langwatch.reserved.context_size_tokens",
          ),
        ).toBe(36297);
      });
    });
  });

  describe("given a reserved sum and a raw per-span key are both offered", () => {
    describe("when only the raw key is present", () => {
      it("falls through to it, so a trace folded before the sum landed still reads", () => {
        expect(
          readNumberAttribute(
            { [RAW_PER_SPAN]: "10" },
            RESERVED_SUM,
            RAW_PER_SPAN,
          ),
        ).toBe(10);
      });
    });

    describe("when both are present", () => {
      it("takes the reserved sum, since the raw key only carries one span's share", () => {
        expect(
          readNumberAttribute(
            { [RESERVED_SUM]: "54740", [RAW_PER_SPAN]: "10" },
            RESERVED_SUM,
            RAW_PER_SPAN,
          ),
        ).toBe(54740);
      });
    });

    describe("when the first key holds something that is not a number", () => {
      it("keeps looking and takes the next key that parses", () => {
        expect(
          readNumberAttribute(
            { [RESERVED_SUM]: "not-a-number", [RAW_PER_SPAN]: "7" },
            RESERVED_SUM,
            RAW_PER_SPAN,
          ),
        ).toBe(7);
      });
    });
  });

  describe("given none of the requested keys are present", () => {
    describe("when the value is read", () => {
      it("returns null rather than zero, which a caller would render as a real reading", () => {
        expect(
          readNumberAttribute({}, "langwatch.reserved.context_size_tokens"),
        ).toBeNull();
      });
    });
  });
});
