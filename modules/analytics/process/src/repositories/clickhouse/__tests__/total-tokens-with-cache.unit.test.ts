/** Spec: specs/trace-processing/trace-token-totals.feature. */
import { describe, expect, it } from "vitest";

import { translateMetric } from "../clickhouse.metric-translator.mapper.ts";

describe("the analytics total tokens metric", () => {
  /** @scenario "The analytics total tokens metric counts the cache" */
  it("adds the cache reads and writes on trace summaries", () => {
    const { selectExpression } = translateMetric({
      metric: "performance.total_tokens",
      aggregation: "sum",
      index: 0,
    });

    expect(selectExpression).toContain("TotalPromptTokenCount");
    expect(selectExpression).toContain("TotalCompletionTokenCount");
    expect(selectExpression).toContain("langwatch.reserved.cache_read_tokens");
    expect(selectExpression).toContain("langwatch.reserved.cache_creation_tokens");
  });
});
