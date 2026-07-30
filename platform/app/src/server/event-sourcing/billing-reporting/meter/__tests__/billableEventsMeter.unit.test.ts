/**
 * Unit tests for the billable-events meter's pure mapping logic and its
 * group-key descriptor.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  BILLABLE_EVENT_TYPES,
  type BillableSourceEvent,
  billableEventsMeterGroupKey,
  createBillableEventsMeterProjection,
  extractDeduplicationKey,
  mapBillableEvent,
  renderBillableEventsMeterGroupKey,
} from "../billableEventsMeter";

function makeEvent(
  overrides: Partial<BillableSourceEvent> = {},
): BillableSourceEvent {
  return {
    id: "evt-1",
    tenantId: "proj-1",
    type: "lw.obs.trace.span_received",
    createdAt: Date.UTC(2026, 1, 15, 10, 0, 0),
    ...overrides,
  };
}

describe("extractDeduplicationKey", () => {
  describe("given an event with an idempotencyKey", () => {
    it("uses the idempotencyKey", () => {
      const result = extractDeduplicationKey(
        makeEvent({ id: "evt-1", idempotencyKey: "business-key-123" }),
      );
      expect(result).toBe("business-key-123");
    });
  });

  describe("given an event with no idempotencyKey", () => {
    it("falls back to the event id", () => {
      const result = extractDeduplicationKey(makeEvent({ id: "evt-42" }));
      expect(result).toBe("evt-42");
    });
  });

  describe("given the same event delivered twice", () => {
    it("produces the identical key both times", () => {
      // This is the property that makes redelivery safe: two calls for the
      // same event (a retry, a replay) must land on the same
      // ReplacingMergeTree sort key, or the "one row per dedup key" guarantee
      // billableEventsTable.ts documents does not hold.
      const event = makeEvent({ id: "evt-1", idempotencyKey: "biz-1" });
      const first = extractDeduplicationKey(event);
      const second = extractDeduplicationKey({ ...event });
      expect(first).toBe(second);
    });
  });
});

describe("mapBillableEvent", () => {
  describe("given any billable event", () => {
    it("produces a record carrying the dedup key and the event's own fields", () => {
      const result = mapBillableEvent(
        makeEvent({ id: "evt-1", type: "lw.obs.trace.span_received" }),
      );

      expect(result).toEqual({
        eventId: "evt-1",
        eventType: "lw.obs.trace.span_received",
        deduplicationKey: "evt-1",
        eventTimestamp: Date.UTC(2026, 1, 15, 10, 0, 0),
      });
    });
  });

  describe("given an event with an idempotencyKey", () => {
    it("uses it as the record's dedup key", () => {
      const result = mapBillableEvent(
        makeEvent({
          id: "evt-1",
          idempotencyKey: "idem-key-abc",
          type: "lw.evaluation.reported",
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          deduplicationKey: "idem-key-abc",
          eventType: "lw.evaluation.reported",
        }),
      );
    });
  });

  describe("given the same event mapped twice", () => {
    it("produces byte-identical records, so redelivery is a no-op at the map layer", () => {
      const event = makeEvent();
      expect(mapBillableEvent(event)).toEqual(mapBillableEvent({ ...event }));
    });
  });
});

describe("billableEventsMeterGroupKey", () => {
  describe("given events from the same project", () => {
    it("renders the same group key", () => {
      const first = renderBillableEventsMeterGroupKey(
        makeEvent({ tenantId: "proj-1", id: "evt-1" }),
      );
      const second = renderBillableEventsMeterGroupKey(
        makeEvent({ tenantId: "proj-1", id: "evt-2" }),
      );
      expect(first).toBe(second);
    });
  });

  describe("given events from different projects", () => {
    it("renders different group keys, so the two projects never share a lane", () => {
      const first = renderBillableEventsMeterGroupKey(
        makeEvent({ tenantId: "proj-1" }),
      );
      const second = renderBillableEventsMeterGroupKey(
        makeEvent({ tenantId: "proj-2" }),
      );
      expect(first).not.toBe(second);
    });
  });

  describe("given the descriptor itself", () => {
    it("is a map lane scoped to a partition of the project id, not per-event", () => {
      const key = billableEventsMeterGroupKey(
        makeEvent({ tenantId: "proj-1" }),
      );
      expect(key).toEqual({
        tenantId: "proj-1",
        lane: { kind: "map", name: "billableEventsMeter" },
        scope: { kind: "partition", parts: ["proj-1"] },
      });
    });
  });
});

describe("BILLABLE_EVENT_TYPES", () => {
  it("spans the 4 pipelines that produce billable usage", () => {
    expect(BILLABLE_EVENT_TYPES).toEqual([
      "lw.obs.trace.span_received",
      "lw.evaluation.reported",
      "lw.experiment_run.started",
      "lw.experiment_run.evaluator_result",
      "lw.experiment_run.target_result",
      "lw.simulation_run.started",
      "lw.simulation_run.message_snapshot",
    ]);
  });
});

describe("createBillableEventsMeterProjection", () => {
  describe("given a delivery of billable events", () => {
    it("writes one record per event through the injected store", async () => {
      const writeBatch = vi.fn().mockResolvedValue(undefined);
      const projection = createBillableEventsMeterProjection({
        store: { kind: "append", writeBatch },
      });

      const outcome = await projection.apply({
        tenantId: "proj-1",
        events: [makeEvent({ id: "evt-1" }), makeEvent({ id: "evt-2" })],
      });

      expect(outcome).toEqual({ written: 2 });
      expect(writeBatch).toHaveBeenCalledTimes(1);
      expect(writeBatch).toHaveBeenCalledWith(
        [
          expect.objectContaining({ eventId: "evt-1" }),
          expect.objectContaining({ eventId: "evt-2" }),
        ],
        { tenantId: "proj-1", retentionDays: undefined },
      );
    });
  });

  describe("given the store rejects the write", () => {
    it("propagates the failure rather than swallowing it", async () => {
      const writeBatch = vi
        .fn()
        .mockRejectedValue(new Error("clickhouse unavailable"));
      const projection = createBillableEventsMeterProjection({
        store: { kind: "append", writeBatch },
      });

      await expect(
        projection.apply({ tenantId: "proj-1", events: [makeEvent()] }),
      ).rejects.toThrow("clickhouse unavailable");
    });
  });
});
