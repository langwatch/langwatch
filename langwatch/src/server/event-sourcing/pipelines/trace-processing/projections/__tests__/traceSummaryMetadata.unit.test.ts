import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { createTenantId } from "~/server/event-sourcing";
import {
  TRACE_METADATA_CHANGED_EVENT_TYPE,
  TRACE_METADATA_CHANGED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import type { TraceMetadataChangedEvent } from "../../schemas/events";
import {
  applySpanToSummary,
  TraceSummaryFoldProjection,
} from "../traceSummary.foldProjection";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

function makeMetadataChangedEvent({
  metadata,
  changedByUserId = "user-123",
  traceId = "trace-1",
}: {
  metadata: Record<string, unknown>;
  changedByUserId?: string | null;
  traceId?: string;
}): TraceMetadataChangedEvent {
  return {
    id: `evt-metadata-${Date.now()}`,
    type: TRACE_METADATA_CHANGED_EVENT_TYPE,
    version: TRACE_METADATA_CHANGED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: traceId,
    tenantId: createTenantId("tenant-1"),
    createdAt: Date.now(),
    occurredAt: Date.now(),
    data: { traceId, metadata, changedByUserId },
    metadata: {},
  };
}

function makeProjection() {
  const store = {
    store: async () => {},
    get: async () => null,
  };
  return new TraceSummaryFoldProjection({ store });
}

describe("TraceSummaryFoldProjection metadata handler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(99999);
    vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    ).mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when user_id is updated via metadata event", () => {
    it("maps user_id to langwatch.user_id and preserves other attributes", () => {
      const projection = makeProjection();
      const state = {
        ...createInitState(),
        traceId: "trace-1",
        attributes: { "metadata.team": "platform", "langwatch.user_id": "original-user" },
      };

      const result = projection.handleTraceTraceMetadataChanged(
        makeMetadataChangedEvent({ metadata: { user_id: "new-user" } }),
        state,
      );

      expect(result.attributes["langwatch.user_id"]).toBe("new-user");
      expect(result.attributes["metadata.team"]).toBe("platform");
    });
  });

  describe("when customer_id is updated via metadata event", () => {
    it("maps customer_id to langwatch.customer_id", () => {
      const projection = makeProjection();
      const state = {
        ...createInitState(),
        traceId: "trace-1",
        attributes: { "langwatch.user_id": "user-1" },
      };

      const result = projection.handleTraceTraceMetadataChanged(
        makeMetadataChangedEvent({ metadata: { customer_id: "cust-99" } }),
        state,
      );

      expect(result.attributes["langwatch.customer_id"]).toBe("cust-99");
      expect(result.attributes["langwatch.user_id"]).toBe("user-1");
    });
  });

  describe("when thread_id is updated via metadata event", () => {
    it("maps thread_id to gen_ai.conversation.id", () => {
      const projection = makeProjection();
      const state = createInitState();

      const result = projection.handleTraceTraceMetadataChanged(
        makeMetadataChangedEvent({ metadata: { thread_id: "thread-42" } }),
        state,
      );

      expect(result.attributes["gen_ai.conversation.id"]).toBe("thread-42");
    });
  });

  describe("when labels are set via metadata event", () => {
    it("replaces existing labels and sets the override latch", () => {
      const projection = makeProjection();
      const state = {
        ...createInitState(),
        attributes: { "langwatch.labels": '["production"]' },
      };

      const result = projection.handleTraceTraceMetadataChanged(
        makeMetadataChangedEvent({ metadata: { labels: ["qa", "reviewed"] } }),
        state,
      );

      expect(result.attributes["langwatch.labels"]).toBe('["qa","reviewed"]');
      expect(result.labelsUserOverridden).toBe(true);
    });
  });

  describe("when a late-arriving span has labels and the latch is set", () => {
    it("does not clobber API-set labels", () => {
      const state = {
        ...createInitState(),
        traceId: "trace-1",
        attributes: { "langwatch.labels": '["qa","reviewed"]' },
        labelsUserOverridden: true,
      };

      const span = createTestSpan({
        parentSpanId: null,
        spanAttributes: { "langwatch.labels": '["production"]' },
      });

      const result = applySpanToSummary({ state, span });

      expect(result.attributes["langwatch.labels"]).toBe('["qa","reviewed"]');
    });
  });

  describe("when custom metadata keys are set", () => {
    it("prefixes with metadata. and preserves existing custom keys", () => {
      const projection = makeProjection();
      const state = {
        ...createInitState(),
        attributes: { "metadata.team": "platform" },
      };

      const result = projection.handleTraceTraceMetadataChanged(
        makeMetadataChangedEvent({ metadata: { environment: "staging" } }),
        state,
      );

      expect(result.attributes["metadata.environment"]).toBe("staging");
      expect(result.attributes["metadata.team"]).toBe("platform");
    });
  });

  describe("when custom metadata JSON objects are deep-merged", () => {
    it("merges new keys into existing JSON object", () => {
      const projection = makeProjection();
      const state = {
        ...createInitState(),
        attributes: { "metadata.config": '{"retries":3}' },
      };

      const result = projection.handleTraceTraceMetadataChanged(
        makeMetadataChangedEvent({ metadata: { config: { timeout: 30 } } }),
        state,
      );

      expect(JSON.parse(result.attributes["metadata.config"]!)).toEqual({
        retries: 3,
        timeout: 30,
      });
    });
  });

  describe("when metadata is updated", () => {
    it("does not affect non-metadata trace fields", () => {
      const projection = makeProjection();
      const state = {
        ...createInitState(),
        traceId: "trace-1",
        traceName: "My Trace",
        spanCount: 5,
        totalDurationMs: 1234,
      };

      const result = projection.handleTraceTraceMetadataChanged(
        makeMetadataChangedEvent({ metadata: { user_id: "new-user" } }),
        state,
      );

      expect(result.traceName).toBe("My Trace");
      expect(result.spanCount).toBe(5);
      expect(result.totalDurationMs).toBe(1234);
    });
  });

  describe("when traceId is not yet set on state", () => {
    it("sets traceId from event data", () => {
      const projection = makeProjection();
      const state = createInitState();

      const result = projection.handleTraceTraceMetadataChanged(
        makeMetadataChangedEvent({ metadata: { user_id: "user-1" }, traceId: "trace-abc" }),
        state,
      );

      expect(result.traceId).toBe("trace-abc");
    });
  });

  describe("when key already has metadata. prefix", () => {
    it("does not double-prefix", () => {
      const projection = makeProjection();
      const state = createInitState();

      const result = projection.handleTraceTraceMetadataChanged(
        makeMetadataChangedEvent({ metadata: { "metadata.custom_key": "value" } }),
        state,
      );

      expect(result.attributes["metadata.custom_key"]).toBe("value");
      expect(result.attributes["metadata.metadata.custom_key"]).toBeUndefined();
    });
  });
});
