/**
 * The translator's node ceiling, as the server answers it.
 * @see specs/traces-v2/search.feature
 */

import {
  FILTER_TOO_COMPLEX_MESSAGE,
  FilterTooComplexError,
  MAX_FILTER_NODE_COUNT,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { translateFilter } from "../trace-query.rules.ts";

const compile = (queryText: string) =>
  translateFilter({
    queryText,
    tenantId: "project-1",
    timeRange: { from: 1_000, to: 2_000 },
  });

const ELEVEN_BARE_WORDS = "one two three four five six seven eight nine ten eleven";

describe("given a filter with more than twenty nodes", () => {
  describe("when it is compiled for ClickHouse", () => {
    /** @scenario "The server refuses a sentence past the term ceiling with its own code" */
    it("refuses it as too complex, with the ceiling the client checks", () => {
      let refusal: FilterTooComplexError | undefined;
      try {
        compile(ELEVEN_BARE_WORDS);
      } catch (error) {
        refusal = error as FilterTooComplexError;
      }

      expect(refusal).toBeInstanceOf(FilterTooComplexError);
      expect(refusal?.code).toBe("filter_too_complex");
      expect(refusal?.httpStatus).toBe(422);
      expect(refusal?.fault).toBe("customer");
      expect(refusal?.meta).toMatchObject({ maxNodes: MAX_FILTER_NODE_COUNT });
      expect(refusal?.message).toBe(FILTER_TOO_COMPLEX_MESSAGE);
    });
  });
});

describe("given an evaluator bound to excluded verdicts", () => {
  // `head` and n excluded verdicts span 3n + 1 nodes either way: bound under
  // `evaluator:X`, walked tag by tag under `evaluatorStatus`. Same ceiling.
  const chain = (head: string, n: number): string =>
    [head, ...Array.from({ length: n }, () => "NOT evaluatorVerdict:fail")].join(" AND ");
  const lastAllowed = Math.floor((MAX_FILTER_NODE_COUNT - 1) / 3);

  describe.each([
    ["bound", "evaluator:X"],
    ["walked tag by tag", "evaluatorStatus:processed"],
  ])("when the chain is %s", (_, head) => {
    it("compiles at the ceiling", () => {
      expect(compile(chain(head, lastAllowed))).not.toBeNull();
    });

    it("refuses one verdict past it", () => {
      expect(() => compile(chain(head, lastAllowed + 1))).toThrow(FilterTooComplexError);
    });
  });
});

describe("given the same sentence in quotes", () => {
  describe("when it is compiled for ClickHouse", () => {
    it("compiles as one phrase node", () => {
      expect(compile(`"${ELEVEN_BARE_WORDS}"`)?.sql).toContain("ILIKE");
    });
  });
});

describe("given a broken query", () => {
  describe("when it is compiled for ClickHouse", () => {
    it("still answers filter_parse_error: the two refusals stay apart", () => {
      expect(() => compile('status:"unclosed')).toThrow(
        expect.objectContaining({ code: "filter_parse_error" }),
      );
    });
  });
});
