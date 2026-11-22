import { analyticsMetricAggregations } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { analyticsMetrics } from "../analytics-registry.ts";

const byName = (left: string, right: string): number => left.localeCompare(right);

describe("analyticsMetrics", () => {
  /** @scenario "The browser's metric registry offers exactly the aggregations the service accepts" */
  it("offers the aggregations the service accepts, metric for metric", () => {
    const offered = Object.fromEntries(
      Object.entries(analyticsMetrics).flatMap(([group, metrics]) =>
        Object.entries(metrics).map(([metric, definition]) => [
          `${group}.${metric}`,
          definition.allowedAggregations.toSorted(byName),
        ]),
      ),
    );
    const accepted = Object.fromEntries(
      Object.entries(analyticsMetricAggregations).map(([metric, aggregations]) => [
        metric,
        aggregations.toSorted(byName),
      ]),
    );

    expect(offered).toEqual(accepted);
  });
});
