/** Spec: specs/trace-processing/trace-token-totals.feature. */
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { createInitState } from "../../eventing/__tests__/trace-summary-test.fixtures.ts";
import { FACET_REGISTRY } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { LANGWATCH_QL_TRACE_FILTER_EXPRESSIONS } from "../../features/query/rules/trace-query-langwatch-ql.rules.ts";
import { cursorForTraceRow, mapToTraceListItem } from "../trace-list-row.rules.ts";
import { mapTraceSummaryToHeader } from "../trace-read-mappers.rules.ts";
import { TRACE_SUMMARY_TOTAL_TOKENS_FILTER_SQL } from "../trace-token-total.rules.ts";

/** 30 fresh input, 44 output, 15217 written to the cache and 15217 read back. */
const CACHED_TRACE_TOTAL = 30 + 44 + 15_217 + 15_217;

function cachedSummary(): TraceSummaryData {
  return {
    ...createInitState(),
    traceId: "c1a0de0e1e5700000000000000000001",
    totalPromptTokenCount: 30,
    totalCompletionTokenCount: 44,
    attributes: {
      "langwatch.reserved.cache_read_tokens": "15217",
      "langwatch.reserved.cache_creation_tokens": "15217",
    },
  };
}

describe("a trace's total tokens", () => {
  describe("given a trace whose calls wrote and read the prompt cache", () => {
    /** @scenario "The trace list and the trace header show the total with the cache" */
    it("counts the cache reads and writes in the list row and the header", () => {
      const row = mapToTraceListItem({ ...cachedSummary(), tenantId: "project-1" });
      const header = mapTraceSummaryToHeader(cachedSummary());

      expect(row.totalTokens).toBe(CACHED_TRACE_TOTAL);
      expect(row.inputTokens).toBe(30);
      expect(header.totalTokens).toBe(CACHED_TRACE_TOTAL);
      expect(header.inputTokens).toBe(30);
    });

    /** @scenario "Filtering and sorting by tokens use the total with the cache" */
    it("pages a token sort and evaluates a token filter at the same total", () => {
      const cursor = cursorForTraceRow(
        { ...cachedSummary(), tenantId: "project-1" },
        "TotalTokens",
      );
      const facet = FACET_REGISTRY.find((definition) => definition.key === "tokens");
      if (facet?.kind !== "range" || !facet.read) throw new Error("no in-memory tokens facet");

      expect(cursor.sortValue).toBe(CACHED_TRACE_TOTAL);
      expect(facet.read({ summary: cachedSummary() })).toBe(CACHED_TRACE_TOTAL);
      expect(facet.expression).toBe(TRACE_SUMMARY_TOTAL_TOKENS_FILTER_SQL);
      expect(LANGWATCH_QL_TRACE_FILTER_EXPRESSIONS.tokens?.expression).toBe(
        TRACE_SUMMARY_TOTAL_TOKENS_FILTER_SQL,
      );
    });
  });

  describe("given a trace with no output count", () => {
    it("leaves the token filter's in-memory total empty, as the SQL sum is", () => {
      const facet = FACET_REGISTRY.find((definition) => definition.key === "tokens");
      if (facet?.kind !== "range" || !facet.read) throw new Error("no in-memory tokens facet");

      expect(
        facet.read({ summary: { ...cachedSummary(), totalCompletionTokenCount: null } }),
      ).toBeNull();
    });
  });
});
