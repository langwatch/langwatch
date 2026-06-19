/**
 * Guards the bounded-memory setting on the topic-clustering page fetch.
 *
 * The outer page query reads ComputedInput (a potentially large payload) for
 * up to 2000 traces. Peak memory scales with the number of read streams holding
 * a ComputedInput block at once; for tenants with large inputs that peak crossed
 * max_memory_usage_per_query (MEMORY_LIMIT_EXCEEDED). This is a background
 * clustering batch, so the read is capped to a small max_threads to keep peak
 * memory under the per-query limit. Correctness under the cap is covered by
 * fetchTracesFromClickHouse.integration.test.ts; this guards the setting itself.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("topicClustering page fetch memory guard", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "topicClustering.ts"),
    "utf-8",
  );

  it("caps the page fetch read streams with a small max_threads", () => {
    expect(source).toMatch(/clickhouse_settings:\s*\{\s*max_threads:\s*[1-4]\s*\}/);
  });
});
