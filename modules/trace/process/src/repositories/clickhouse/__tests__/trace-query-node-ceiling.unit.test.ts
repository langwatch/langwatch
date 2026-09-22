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

import { ClickHouseTraceQueryRepository } from "../clickhouse.trace-query.repository.ts";

const traceQueryRepository = ClickHouseTraceQueryRepository.create();

const compile = (queryText: string) =>
  traceQueryRepository.translateFilter({
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
