import { readFileSync } from "node:fs";

import { createTenantId } from "@langwatch/eventing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  TraceAnalyticsRollupMapProjection,
  type TraceAnalyticsRollupRow,
} from "../trace-analytics-rollup.projection.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "../trace-analytics.projection.ts";

/**
 * Golden rows trace's own writers produced (trace-derived / trace-rollup at c4727230ee) for these
 * events, under the same frozen clock: analytics' copies must produce them unchanged.
 */
type GoldenEvent = { type: string; tenantId: string } & Record<string, unknown>;
type Golden = {
  baseMs: number;
  traces: {
    events: GoldenEvent[];
    row: Record<string, unknown>;
    rollupRows: (Record<string, unknown> | null)[];
  }[];
};

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/trace-analytics-golden.fixture.json", import.meta.url), "utf8"),
) as Golden;

const SPAN_RECEIVED = "lw.obs.trace.span_received";
const TENANT = "tenant-golden";

const fold = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
});
const rollup = TraceAnalyticsRollupMapProjection.create({
  store: { append: async () => {}, bulkAppend: async () => {} } as never,
});

function asEvent(event: GoldenEvent): never {
  return { ...event, tenantId: createTenantId(event.tenantId) } as never;
}

function serialisedRollup(row: TraceAnalyticsRollupRow | null): Record<string, unknown> | null {
  return row ? { ...row, bucketStart: row.bucketStart.toString() } : null;
}

describe("analytics' trace analytics writers against trace's golden rows", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(golden.baseMs);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  describe.each(golden.traces.map((trace, index) => ({ index, ...trace })))(
    "given golden trace $index",
    ({ events, row, rollupRows }) => {
      /** @scenario A received span lands in trace_analytics once */
      it("folds the same trace_analytics row trace's writer produced", () => {
        const state = events.reduce<TraceAnalyticsData>(
          (folded, event) => fold.apply(folded, asEvent(event)),
          fold.init(),
        );
        const projected = TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
          state,
          tenantId: TENANT,
          version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
        });

        expect(JSON.parse(JSON.stringify(projected))).toEqual(row);
      });

      /** @scenario The rollup counts each span once */
      it("maps each span to the same rollup contribution trace's writer produced", () => {
        const mapped = events
          .filter((event) => event.type === SPAN_RECEIVED)
          .map((event) => serialisedRollup(rollup.mapTraceSpanReceived(asEvent(event))));

        expect(mapped).toEqual(rollupRows);
      });
    },
  );
});
