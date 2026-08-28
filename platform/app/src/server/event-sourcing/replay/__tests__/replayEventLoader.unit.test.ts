import { describe, expect, it } from "vitest";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import type { ClickHouseEventRow } from "@langwatch/eventing/server";
import { rowToEvent } from "@langwatch/eventing/server";
import { leanReplayEvent } from "~/server/app-layer/traces/lean-for-projection";

function makeRow(overrides: Partial<ClickHouseEventRow>): ClickHouseEventRow {
  return {
    TenantId: "tenant-1",
    AggregateType: "trace",
    AggregateId: "agg-1",
    EventId: "evt-001",
    EventType: "test.event",
    EventTimestamp: 1_700_000_000_000,
    EventOccurredAt: 1_700_000_000_000,
    EventVersion: "2025-01-01",
    EventPayload: "{}",
    IdempotencyKey: "evt-001",
    ...overrides,
  };
}

describe("rowToEvent", () => {
  describe("when a row's payload carries an oversized IO attribute", () => {
    // Regression: map replay used to transform the RAW event, so replayed
    // spans/logs kept oversized full content instead of the previews live
    // dispatch produces. The lean now happens exactly once, at
    // materialization, for every replay path — this pins it at that seam.
    it("leans oversized IO attributes to the same previews live dispatch produces", () => {
      const oversized = "x".repeat(200_000); // well over the 64 KB IO preview
      const event = rowToEvent(
        makeRow({
          EventType: SPAN_RECEIVED_EVENT_TYPE,
          EventPayload: JSON.stringify({
            span: {
              attributes: [
                { key: "langwatch.output", value: { stringValue: oversized } },
              ],
            },
          }),
        }),
        leanReplayEvent,
      );

      const attrs = (event.data as any)?.span?.attributes ?? [];
      const out =
        attrs.find((a: any) => a.key === "langwatch.output")?.value?.stringValue ?? "";
      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThan(oversized.length);
    });
  });

  describe("when a row has no occurred-at value", () => {
    it("falls back to the event timestamp", () => {
      const event = rowToEvent(makeRow({ EventOccurredAt: 0 }), leanReplayEvent);
      expect(event.occurredAt).toBe(1_700_000_000_000);
    });
  });
});
