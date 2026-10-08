/**
 * @vitest-environment node
 * Spec: specs/traces/explicit-application-origin.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_TYPE,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  type DeferredOriginPayload,
  DEFERRED_ORIGIN_DELAY_MS,
  DEFERRED_ORIGIN_SUBSCRIBER_NAME,
  createDeferredOriginHandler,
} from "../deferred-origin.subscriber.ts";
import type { EventingRecordSpanAdapter } from "../record-span.commands.ts";
import {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "../trace-processing-projections.pipeline.ts";
import { buildTraceProcessingConsumer } from "../trace-processing.pipeline.ts";

type Options = EventingTracePipelineAdapterOptions;
type Reactions = Parameters<typeof buildTraceProcessingConsumer>[1];

function consumer({ resolveDeferredOrigin }: Pick<Reactions, "resolveDeferredOrigin">) {
  const projections = EventingTracePipelineAdapter.create({
    spanStore: createApiFixture<Options["spanStore"]>(),
    summaryStore: createApiFixture<Options["summaryStore"]>(),
    derivedStore: createApiFixture<Options["derivedStore"]>(),
    rollupStore: createApiFixture<Options["rollupStore"]>(),
    canonicalisation: TraceCanonicalisationService.create(),
    ioExtraction: createApiFixture<Options["ioExtraction"]>(),
    mediaReferences: createApiFixture<Options["mediaReferences"]>(),
    modelCosts: createApiFixture<Options["modelCosts"]>(),
    spanNormalization: createApiFixture<Options["spanNormalization"]>(),
    prepareEventForProjection: (event) => event,
    recordSpanCommand: createApiFixture<EventingRecordSpanAdapter>(),
  }).build();
  const noop = vi.fn().mockResolvedValue(undefined);
  return buildTraceProcessingConsumer(projections, {
    resolveDeferredOrigin,
    trackedEventSync: noop,
    traceUpdateBroadcast: noop,
    projectMetadata: noop,
    spanStorageBroadcast: noop,
    broadcastDisabled: false,
  });
}

function registration(resolveDeferredOrigin = vi.fn().mockResolvedValue(undefined)) {
  const entry = consumer({ resolveDeferredOrigin }).foldSubscribers.get(
    DEFERRED_ORIGIN_SUBSCRIBER_NAME,
  );
  if (!entry) throw new Error("the pipeline registered no deferredOriginResolution subscriber");
  return { ...entry, resolveDeferredOrigin };
}

function spanEvent(overrides: Partial<TraceProcessingEvent> = {}): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: 1,
    data: {},
    metadata: { spanId: "span-1", traceId: "trace-1" },
    ...overrides,
  } as TraceProcessingEvent;
}

function foldState(origin?: string): TraceSummaryData {
  const attributes = origin ? { "langwatch.origin": origin } : {};
  return { traceId: "trace-1", attributes } as TraceSummaryData;
}

function dispatchContext(state: TraceSummaryData) {
  return { tenantId: "tenant-1", aggregateId: "trace-1", foldState: state };
}

describe("the deferredOriginResolution subscriber on trace_processing", () => {
  it("is a fold subscriber on traceSummary, not a process manager", () => {
    const pipeline = consumer({ resolveDeferredOrigin: vi.fn() });

    expect(pipeline.foldSubscribers.get(DEFERRED_ORIGIN_SUBSCRIBER_NAME)?.projectionName).toBe(
      "traceSummary",
    );
    expect(pipeline.processManagers.has(DEFERRED_ORIGIN_SUBSCRIBER_NAME)).toBe(false);
  });

  describe("given several spans of one trace arrive with no origin", () => {
    /** @scenario "Deferred check deduplicates per trace" */
    it("holds one job per trace whose deadline the first span sets", () => {
      const { options } = registration().definition;
      const first = { event: spanEvent(), foldState: foldState() };
      const later = { event: spanEvent({ id: "event-2" }), foldState: foldState() };
      const otherTrace = { event: spanEvent({ aggregateId: "trace-2" }), foldState: foldState() };

      expect(options?.delay).toBe(DEFERRED_ORIGIN_DELAY_MS);
      expect(options?.deduplication?.extend).toBe(false);
      expect(options?.deduplication?.replace).toBe(false);
      expect(options?.deduplication?.ttlMs).toBeGreaterThan(DEFERRED_ORIGIN_DELAY_MS);
      expect(options?.makeJobId).toBe(options?.deduplication?.makeId);
      expect(options?.deduplication?.makeId(first)).toBe(
        "subscriber:deferredOriginResolution:tenant-1:trace-1",
      );
      expect(options?.deduplication?.makeId(later)).toBe(options?.deduplication?.makeId(first));
      expect(options?.deduplication?.makeId(otherTrace)).not.toBe(
        options?.deduplication?.makeId(first),
      );
    });
  });

  describe("when deciding whether a span arms the fallback", () => {
    it("arms a span arrival whose trace has no origin yet", () => {
      const { definition } = registration();

      expect(definition.shouldDispatch?.(spanEvent(), dispatchContext(foldState()))).toBe(true);
    });

    it("leaves a trace whose fold already names an origin unarmed", () => {
      const { definition } = registration();

      expect(
        definition.shouldDispatch?.(spanEvent(), dispatchContext(foldState("application"))),
      ).toBe(false);
    });

    it("leaves a re-emitted topic assignment unarmed", () => {
      const { definition } = registration();
      const topic = spanEvent({ type: TOPIC_ASSIGNED_EVENT_TYPE });

      expect(definition.shouldDispatch?.(topic, dispatchContext(foldState()))).toBe(false);
    });

    it("leaves a span older than the stale threshold unarmed", () => {
      const { definition } = registration();
      const stale = spanEvent({ occurredAt: Date.now() - 2 * 60 * 60 * 1000 });

      expect(definition.shouldDispatch?.(stale, dispatchContext(foldState()))).toBe(false);
    });
  });

  describe("when the armed job fires", () => {
    it("asks for the trace's deferred origin resolution", async () => {
      const { definition, resolveDeferredOrigin } = registration();

      await definition.handle(spanEvent(), dispatchContext(foldState()));

      expect(resolveDeferredOrigin).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        traceId: "trace-1",
      });
    });
  });
});

describe("createDeferredOriginHandler()", () => {
  describe("when called", () => {
    /** @scenario 'Deferred check treats still-empty origin as "application"' */
    it("dispatches resolveOrigin command unconditionally", async () => {
      const resolveOriginFn = vi.fn().mockResolvedValue(undefined);
      const handler = createDeferredOriginHandler(resolveOriginFn);
      const payload: DeferredOriginPayload = {
        id: "trace-1",
        tenantId: "tenant-1",
        traceId: "trace-1",
      };

      await handler(payload);

      expect(resolveOriginFn).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        traceId: "trace-1",
        origin: "application",
        reason: "deferred_fallback",
        occurredAt: expect.any(Number),
      });
      // occurredAt should be the dispatch time (now), not the original trace time
      const calledOccurredAt = resolveOriginFn.mock.calls[0]![0].occurredAt;
      expect(calledOccurredAt).toBeGreaterThanOrEqual(Date.now() - 1000);
      expect(calledOccurredAt).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  describe("when the trace id is empty", () => {
    it("dispatches nothing", async () => {
      const resolveOriginFn = vi.fn().mockResolvedValue(undefined);
      const handler = createDeferredOriginHandler(resolveOriginFn);

      await handler({ id: "", tenantId: "tenant-1", traceId: "" });

      expect(resolveOriginFn).not.toHaveBeenCalled();
    });
  });

  describe("when resolveOrigin throws", () => {
    it("propagates the error", async () => {
      const resolveOriginFn = vi.fn().mockRejectedValue(new Error("command failed"));
      const handler = createDeferredOriginHandler(resolveOriginFn);
      const payload: DeferredOriginPayload = {
        id: "trace-1",
        tenantId: "tenant-1",
        traceId: "trace-1",
      };

      await expect(handler(payload)).rejects.toThrow("command failed");
    });
  });
});
