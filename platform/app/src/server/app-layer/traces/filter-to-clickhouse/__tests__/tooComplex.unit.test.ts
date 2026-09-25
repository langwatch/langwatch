/**
 * The translator's node ceiling has its own handled code, so a sentence
 * typed as bare words is refused with copy that says what to do (quote it)
 * rather than the generic parse error.
 *
 * Spec: specs/traces-v2/search.feature ("A sentence past the term ceiling").
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import { MAX_FILTER_NODE_COUNT } from "../../query-language/queries";
import { translateFilterToClickHouse } from "../ast";

const TENANT = "tenant-1";
const RANGE = { from: 0, to: 1 };

const words = (n: number): string =>
  Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

function refusal(query: string): HandledError {
  try {
    translateFilterToClickHouse(query, TENANT, RANGE);
  } catch (error) {
    if (error instanceof HandledError) return error;
    throw error;
  }
  throw new Error("expected the translator to refuse");
}

describe("given eleven bare words", () => {
  describe("when the filter is translated", () => {
    /** @scenario "The server refuses a sentence past the term ceiling with its own code" */
    it("refuses with filter_too_complex, a 422, customer fault and the ceiling in meta", () => {
      const error = refusal(words(11));
      expect(error.code).toBe("filter_too_complex");
      expect(error.httpStatus).toBe(422);
      expect(error.fault).toBe("customer");
      expect(error.meta).toMatchObject({ maxNodes: MAX_FILTER_NODE_COUNT });
    });
  });
});

describe("given the same sentence in quotes", () => {
  describe("when the filter is translated", () => {
    it("compiles as one phrase node", () => {
      const compiled = translateFilterToClickHouse(
        `"${words(11)}"`,
        TENANT,
        RANGE,
      );
      expect(compiled?.sql).toContain("ILIKE");
    });
  });
});

describe("given a broken query", () => {
  describe("when the filter is translated", () => {
    it("still answers filter_parse_error: the two refusals stay apart", () => {
      expect(refusal('status:"unclosed').code).toBe("filter_parse_error");
    });
  });
});
