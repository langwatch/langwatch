/**
 * The span_analytics floor a span type read uses: looked up only when a read names a span type,
 * and never a reason for that read to fail.
 * @see specs/analytics/span-type-light-reads.feature
 */

import type { AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { UNKNOWN_SPAN_ANALYTICS_FLOOR } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { timeseriesReadsSpanType } from "../../rules/span-type-reads.rules.ts";
import { SpanAnalyticsFloorReadService } from "../span-analytics-floor-read.service.ts";

const FLOOR = { from: "2026-10-01T00:00:00.000Z", rebuilding: false };

describe("SpanAnalyticsFloorReadService", () => {
  describe("given a read that names a span type", () => {
    /** @scenario "A floor that covers the window reads span_analytics alone" */
    it("answers the floor trace recorded", async () => {
      const service = SpanAnalyticsFloorReadService.create({ read: () => Promise.resolve(FLOOR) });

      await expect(service.floor()).resolves.toEqual(FLOOR);
    });

    /** @scenario "A floor that cannot be read keeps stored_spans instead of failing" */
    it("answers the unknown floor when the lookup fails, and warns", async () => {
      const { logger, lines } = createTestLogger();
      const service = SpanAnalyticsFloorReadService.create({
        read: () => Promise.reject(new Error("ledger down")),
        logger,
      });

      await expect(service.floor()).resolves.toBe(UNKNOWN_SPAN_ANALYTICS_FLOOR);
      expect(lines.findLine("warn", "span_analytics floor unreadable")).toBeDefined();
    });
  });

  describe("given a read that names no span type", () => {
    /** @scenario "Only reads that name a span type look up the floor" */
    it("never looks the floor up", async () => {
      const read = vi.fn(() => Promise.resolve(FLOOR));
      const service = SpanAnalyticsFloorReadService.create({ read });

      await expect(service.floorFieldFor(false)).resolves.toEqual({});
      expect(read).not.toHaveBeenCalled();
    });
  });
});

describe("timeseriesReadsSpanType", () => {
  const input = (overrides: Partial<AnalyticsTimeseriesInput>): AnalyticsTimeseriesInput => ({
    projectId: "p1",
    startDate: 0,
    endDate: 1,
    timeZone: "UTC",
    filters: {},
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
    ...overrides,
  });

  /** @scenario "Only reads that name a span type look up the floor" */
  it("is true for a span type filter, series filter, metric or grouping only", () => {
    expect(timeseriesReadsSpanType(input({}))).toBe(false);
    expect(timeseriesReadsSpanType(input({ filters: { "spans.model": ["gpt-5"] } }))).toBe(false);
    expect(timeseriesReadsSpanType(input({ filters: { "spans.type": ["llm"] } }))).toBe(true);
    expect(timeseriesReadsSpanType(input({ groupBy: "metadata.span_type" }))).toBe(true);
    expect(
      timeseriesReadsSpanType(
        input({ series: [{ metric: "spans.type", aggregation: "cardinality" }] }),
      ),
    ).toBe(true);
    expect(
      timeseriesReadsSpanType(
        input({
          series: [
            {
              metric: "metadata.trace_id",
              aggregation: "cardinality",
              filters: { "spans.type": ["tool"] },
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});
