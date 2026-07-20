/**
 * Guards the bounded-memory setting on the topic-clustering page fetch.
 *
 * The outer page query reads ComputedInput (a potentially large payload) for
 * up to 2000 traces. Peak memory scales with the number of read streams holding
 * a ComputedInput block at once; for tenants with large inputs that peak crossed
 * max_memory_usage_per_query (MEMORY_LIMIT_EXCEEDED). This is a background
 * clustering batch, so the read must be capped to a small max_threads to keep
 * peak memory under the per-query limit — and the query must stream (no outer
 * ORDER BY / LIMIT top-N buffer holding every ComputedInput at once).
 */
import { describe, expect, it } from "vitest";

import type { ClickHouseClient } from "@clickhouse/client";

import { fetchTracesFromClickHouse } from "../clustering";

describe("topicClustering page fetch memory guard", () => {
  describe("when the page of traces is fetched", () => {
    async function capturePageFetchQuery() {
      const captured: Array<{
        query: string;
        clickhouse_settings?: Record<string, unknown>;
      }> = [];
      const clickhouse = {
        query: async (params: {
          query: string;
          clickhouse_settings?: Record<string, unknown>;
        }) => {
          captured.push(params);
          return { json: async () => [] };
        },
      } as unknown as ClickHouseClient;

      await fetchTracesFromClickHouse(clickhouse, "project-1", false, [], []);

      const pageFetch = captured.find((c) =>
        c.query.includes("ComputedInput"),
      );
      expect(pageFetch).toBeDefined();
      return pageFetch!;
    }

    it("caps the ComputedInput read to a small max_threads", async () => {
      const pageFetch = await capturePageFetchQuery();

      const maxThreads = pageFetch.clickhouse_settings?.max_threads;
      expect(typeof maxThreads).toBe("number");
      expect(maxThreads).toBeGreaterThanOrEqual(1);
      expect(maxThreads).toBeLessThanOrEqual(4);
    });

    it("streams the outer query without a top-N sort buffer", async () => {
      const pageFetch = await capturePageFetchQuery();

      // The page CTE picks the trace set; the outer query must not re-sort it,
      // because ORDER BY ... LIMIT buffers full rows (every ComputedInput at
      // once). Ordering is reapplied in JS over the small result set instead —
      // so the page CTE's ORDER BY must be the only one in the query.
      expect(pageFetch.query.match(/ORDER BY/gi)).toHaveLength(1);
    });
  });
});
