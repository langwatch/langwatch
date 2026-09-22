/**
 * Every published filter example is parsed, checked the way the search bar
 * checks it, and compiled — an example that stops translating fails here
 * rather than teaching a query the product refuses.
 * @see specs/analytics/query-reference.feature
 */

import {
  parseTraceQuerySyntax,
  TRACE_FILTER_EXAMPLES,
  validateAst,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { ClickHouseTraceQueryRepository } from "../clickhouse.trace-query.repository.ts";

const traceQueryRepository = ClickHouseTraceQueryRepository.create();
const TENANT = "project-1";
const WINDOW = { from: 1_700_000_000_000, to: 1_700_086_400_000 };

describe("given the published trace filter examples", () => {
  it("publishes at least one, each under a unique id", () => {
    expect(TRACE_FILTER_EXAMPLES.length).toBeGreaterThan(0);
    expect(new Set(TRACE_FILTER_EXAMPLES.map((example) => example.id)).size).toBe(
      TRACE_FILTER_EXAMPLES.length,
    );
  });

  describe("when each is read the way a caller would send it", () => {
    it.each(TRACE_FILTER_EXAMPLES.map((example) => [example.id, example.text] as const))(
      "[%s] parses, passes the save-time check and compiles",
      (_id, text) => {
        expect(validateAst(parseTraceQuerySyntax(text))).toBeNull();
        const compiled = traceQueryRepository.translateFilter({
          queryText: text,
          tenantId: TENANT,
          timeRange: WINDOW,
        });
        expect(compiled?.sql).toBeTruthy();
        expect(compiled?.params.tenantId).toBe(TENANT);
      },
    );
  });
});
