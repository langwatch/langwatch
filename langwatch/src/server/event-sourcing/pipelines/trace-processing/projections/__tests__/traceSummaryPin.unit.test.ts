import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TracePinSource } from "../../schemas/constants";
import {
  TRACE_PINNED_EVENT_TYPE,
  TRACE_PINNED_EVENT_VERSION_LATEST,
  TRACE_UNPINNED_EVENT_TYPE,
  TRACE_UNPINNED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import type { TracePinnedEvent, TraceUnpinnedEvent } from "../../schemas/events";
import { TraceSummaryFoldProjection } from "../traceSummary.foldProjection";

function createFoldProjection() {
  const store = {
    store: async () => {},
    get: async () => null,
  };
  return new TraceSummaryFoldProjection({ store });
}

function makeInitState(): TraceSummaryData {
  return createFoldProjection().init();
}

let seq = 0;

function makePinnedEvent({
  source,
  reason = null,
  pinnedByUserId = null,
}: {
  source: TracePinSource;
  reason?: string | null;
  pinnedByUserId?: string | null;
}): TracePinnedEvent {
  seq += 1;
  return {
    id: `evt-pin-${seq}`,
    type: TRACE_PINNED_EVENT_TYPE,
    version: TRACE_PINNED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: "trace-1",
    tenantId: createTenantId("tenant-1"),
    createdAt: 1_000 + seq,
    occurredAt: 1_000 + seq,
    data: { traceId: "trace-1", source, reason, pinnedByUserId },
    metadata: {},
  };
}

function makeUnpinnedEvent({
  source,
}: {
  source: TracePinSource;
}): TraceUnpinnedEvent {
  seq += 1;
  return {
    id: `evt-unpin-${seq}`,
    type: TRACE_UNPINNED_EVENT_TYPE,
    version: TRACE_UNPINNED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: "trace-1",
    tenantId: createTenantId("tenant-1"),
    createdAt: 1_000 + seq,
    occurredAt: 1_000 + seq,
    data: { traceId: "trace-1", source },
    metadata: {},
  };
}

describe("traceSummary fold projection — pin events", () => {
  const projection = createFoldProjection();

  describe("init()", () => {
    it("initializes pin state as unpinned", () => {
      const state = projection.init();
      expect(state.pinnedSource).toBeNull();
      expect(state.pinnedReason).toBeNull();
      expect(state.pinnedByUserId).toBeNull();
      expect(state.pinnedAt).toBeNull();
    });
  });

  describe("when a manual pin is applied", () => {
    it("records source, reason, user and pinnedAt", () => {
      const event = makePinnedEvent({
        source: "manual",
        reason: "investigation",
        pinnedByUserId: "user-1",
      });

      const result = projection.apply(makeInitState(), event);

      expect(result.pinnedSource).toBe("manual");
      expect(result.pinnedReason).toBe("investigation");
      expect(result.pinnedByUserId).toBe("user-1");
      expect(result.pinnedAt).toBe(event.occurredAt);
    });
  });

  describe("when a share pin is applied to an unpinned trace", () => {
    it("records a share pin", () => {
      const result = projection.apply(
        makeInitState(),
        makePinnedEvent({ source: "share" }),
      );

      expect(result.pinnedSource).toBe("share");
    });
  });

  describe("when a share pin is applied to an already-pinned trace", () => {
    it("does not demote a manual pin", () => {
      let state = projection.apply(
        makeInitState(),
        makePinnedEvent({ source: "manual", reason: "keep" }),
      );
      state = projection.apply(state, makePinnedEvent({ source: "share" }));

      expect(state.pinnedSource).toBe("manual");
      expect(state.pinnedReason).toBe("keep");
    });

    it("leaves an existing share pin's pinnedAt untouched", () => {
      const first = makePinnedEvent({ source: "share" });
      let state = projection.apply(makeInitState(), first);
      state = projection.apply(state, makePinnedEvent({ source: "share" }));

      expect(state.pinnedAt).toBe(first.occurredAt);
    });
  });

  describe("when a manual pin promotes a share pin", () => {
    it("overrides source to manual", () => {
      let state = projection.apply(
        makeInitState(),
        makePinnedEvent({ source: "share" }),
      );
      state = projection.apply(
        state,
        makePinnedEvent({ source: "manual", reason: "mine" }),
      );

      expect(state.pinnedSource).toBe("manual");
      expect(state.pinnedReason).toBe("mine");
    });
  });

  describe("when a manual unpin is applied", () => {
    it("clears the pin unconditionally", () => {
      let state = projection.apply(
        makeInitState(),
        makePinnedEvent({ source: "manual" }),
      );
      state = projection.apply(state, makeUnpinnedEvent({ source: "manual" }));

      expect(state.pinnedSource).toBeNull();
      expect(state.pinnedAt).toBeNull();
    });
  });

  describe("when a share unpin is applied", () => {
    it("clears a share pin", () => {
      let state = projection.apply(
        makeInitState(),
        makePinnedEvent({ source: "share" }),
      );
      state = projection.apply(state, makeUnpinnedEvent({ source: "share" }));

      expect(state.pinnedSource).toBeNull();
    });

    it("leaves a manual pin intact", () => {
      let state = projection.apply(
        makeInitState(),
        makePinnedEvent({ source: "manual", reason: "mine" }),
      );
      state = projection.apply(state, makeUnpinnedEvent({ source: "share" }));

      expect(state.pinnedSource).toBe("manual");
      expect(state.pinnedReason).toBe("mine");
    });
  });

  describe("when a trace is pinned, unpinned, then pinned again", () => {
    it("ends up pinned (toggle round-trips)", () => {
      let state = projection.apply(
        makeInitState(),
        makePinnedEvent({ source: "manual" }),
      );
      state = projection.apply(state, makeUnpinnedEvent({ source: "manual" }));
      state = projection.apply(
        state,
        makePinnedEvent({ source: "manual", reason: "again" }),
      );

      expect(state.pinnedSource).toBe("manual");
      expect(state.pinnedReason).toBe("again");
    });
  });
});
