/**
 * @vitest-environment node
 *
 * Runtime-boundary proofs for the event-subscriber seam (ADR-049 §3). These
 * drive the real EventSourcingService over a real in-memory global queue
 * (the same EventSourcedQueueProcessorMemory + JobRegistry dispatch shape
 * eventSourcing.ts wires in production) and a real OTel in-memory exporter,
 * asserting the four operational guarantees:
 *
 *   1. a subscriber receives the full queued event directly, without reading
 *      event_log or any projection;
 *   2. projection execution and subscriber execution are independent jobs, so
 *      a subscriber redelivery never reapplies a committed projection;
 *   3. projection replay never invokes live subscribers — shown against a
 *      subscriber the same test has already watched live dispatch reach, so
 *      the not-called assertion is about the replay path and not about an
 *      unwired spy;  and
 *   4. the publication / queue-processing OTel context is active inside the
 *      subscriber handler, which opens its own span carrying
 *      tenant / pipeline / subscriber attributes.
 */
import { context, SpanKind, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Event } from "../../domain/types";
import { EventSourcedQueueProcessorMemory } from "../../queues/memory";
import type { ReplayEvent } from "../../replay/replayEventLoader";
import { FoldAccumulator } from "../../replay/replayExecutor";
import { EventSourcingService } from "../../services/eventSourcingService";
import type { JobRegistryEntry } from "../../services/queues/queueManager";
import {
  createMockEventStore,
  createMockFoldProjectionDefinition,
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import type { EventSubscriberDefinition } from "../eventSubscriber.types";

/**
 * Builds a real in-memory global queue whose process/spanAttributes callbacks
 * dispatch through the shared JobRegistry — mirroring eventSourcing.ts's
 * `lookupEntry` routing. This is test wiring for the production queue, not a
 * new abstraction: the registry entries under test are the ones the router
 * registers.
 */
function createMemoryGlobalQueue(registry: Map<string, JobRegistryEntry>) {
  const lookup = (
    payload: Record<string, unknown>,
  ): { entry: JobRegistryEntry; clean: Record<string, unknown> } | null => {
    const {
      __pipelineName: pipelineName,
      __jobType: jobType,
      __jobName: jobName,
      ...clean
    } = payload;
    const entry = registry.get(`${pipelineName}:${jobType}:${jobName}`);
    return entry ? { entry, clean } : null;
  };

  return new EventSourcedQueueProcessorMemory<Record<string, unknown>>({
    name: "test-global-queue",
    process: async (payload) => {
      const resolved = lookup(payload);
      if (resolved) await resolved.entry.process(resolved.clean);
    },
    spanAttributes: (payload) => {
      const resolved = lookup(payload);
      return resolved?.entry.spanAttributes?.(resolved.clean) ?? {};
    },
  });
}

const aggregateType = createTestAggregateType();
const tenantId = createTestTenantId();
const context_ = createTestEventStoreReadContext(tenantId);

let provider: NodeTracerProvider;
let exporter: InMemorySpanExporter;

beforeAll(() => {
  exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

afterEach(() => {
  exporter.reset();
  vi.restoreAllMocks();
});

function makeEvent(id: string): Event {
  return createTestEvent(
    TEST_CONSTANTS.AGGREGATE_ID,
    aggregateType,
    tenantId,
    TEST_CONSTANTS.EVENT_TYPE_1,
    TEST_CONSTANTS.BASE_TIMESTAMP,
    "2025-12-17",
    { marker: id },
    id,
  );
}

/**
 * Widen a committed domain event into the row-derived shape replay feeds its
 * accumulators — the same fields `replayEventLoader.rowToEvent` reconstructs
 * from an `event_log` row, so the rebuild below starts from what the log holds.
 */
function toReplayEvent(event: Event): ReplayEvent {
  return {
    id: event.id,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    tenantId: event.tenantId,
    createdAt: event.createdAt,
    timestamp: event.createdAt,
    occurredAt: event.occurredAt,
    type: event.type,
    version: event.version,
    idempotencyKey: event.id,
    data: event.data,
  };
}

describe("event-subscriber runtime boundary", () => {
  describe("given a subscriber running on the global queue", () => {
    it("receives the full queued event without reading event_log or a projection", async () => {
      const eventStore = createMockEventStore<Event>();
      const registry = new Map<string, JobRegistryEntry>();
      const globalQueue = createMemoryGlobalQueue(registry);

      const handled: Array<{ event: Event; context: unknown }> = [];
      const subscriber: EventSubscriberDefinition<Event> = {
        name: "conversationProcess",
        eventTypes: [],
        handle: async (event, ctx) => {
          handled.push({ event, context: ctx });
        },
      };

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        subscribers: [subscriber],
        globalQueue,
        globalJobRegistry: registry,
      });

      const event = makeEvent("evt-full-payload");
      await service.storeEvents([event], context_);

      // The subscriber ran via the queue (a registry entry was registered)…
      expect(registry.has("test-pipeline:subscriber:conversationProcess")).toBe(
        true,
      );
      // …and received the exact committed event the store persisted (the queue
      // carries the full envelope, trace-metadata enrichment included).
      const committedEvent = (
        eventStore.storeEvents as unknown as {
          mock: { calls: [readonly Event[]][] };
        }
      ).mock.calls[0]![0]![0]!;
      expect(handled).toHaveLength(1);
      expect(handled[0]!.event).toEqual(committedEvent);
      expect(handled[0]!.event.id).toBe("evt-full-payload");
      expect(handled[0]!.event.data).toEqual({ marker: "evt-full-payload" });
      expect(handled[0]!.context).toEqual({
        tenantId,
        aggregateId: TEST_CONSTANTS.AGGREGATE_ID,
      });
      // The event was carried by the queue, never re-read from the log/state.
      expect(eventStore.getEvents).not.toHaveBeenCalled();
      expect(eventStore.getEventsUpTo).not.toHaveBeenCalled();
      expect(eventStore.countEventsBefore).not.toHaveBeenCalled();
    });
  });

  describe("given a projection and a subscriber on the same committed event", () => {
    it("runs them as independent jobs so a subscriber redelivery does not reapply the projection", async () => {
      const eventStore = createMockEventStore<Event>();
      const registry = new Map<string, JobRegistryEntry>();
      const globalQueue = createMemoryGlobalQueue(registry);

      const applied: Event[] = [];
      const fold = createMockFoldProjectionDefinition("operationalFold", {
        eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, event: Event) => {
          applied.push(event);
          return { count: state.count + 1 };
        },
      });

      let failFirstSubscriberCall = true;
      const handled: Event[] = [];
      const subscriber: EventSubscriberDefinition<Event> = {
        name: "conversationProcess",
        eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
        handle: async (event) => {
          handled.push(event);
          if (failFirstSubscriberCall) {
            failFirstSubscriberCall = false;
            throw new Error("subscriber transient failure — will be redelivered");
          }
        },
      };

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        foldProjections: [fold],
        subscribers: [subscriber],
        globalQueue,
        globalJobRegistry: registry,
      });

      const event = makeEvent("evt-independent");

      // First delivery: the projection commits; the subscriber throws. The
      // subscriber failure is isolated (storeEvents logs, does not throw).
      await expect(
        service.storeEvents([event], context_),
      ).resolves.not.toThrow();

      expect(applied).toHaveLength(1); // projection applied once
      expect(handled).toHaveLength(1); // subscriber attempted once (threw)

      // At-least-once redelivery of ONLY the subscriber job — exactly what the
      // queue does on retry: re-run the subscriber's registry entry.
      const subscriberEntry = registry.get(
        "test-pipeline:subscriber:conversationProcess",
      );
      expect(subscriberEntry).toBeDefined();
      await subscriberEntry!.process(event as unknown as Record<string, unknown>);

      expect(handled).toHaveLength(2); // subscriber retried and succeeded
      expect(applied).toHaveLength(1); // projection NOT reapplied by the retry
    });
  });

  describe("given a projection replay over canonical events", () => {
    it("rebuilds the projection without invoking a subscriber that live dispatch does reach", async () => {
      const applied: Event[] = [];
      const fold = createMockFoldProjectionDefinition("operationalFold", {
        eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
        init: () => ({ count: 0 }),
        apply: (state: { count: number }, event: Event) => {
          applied.push(event);
          return { count: state.count + 1 };
        },
      });

      // A subscriber observing the same event types as the fold.
      const subscriberHandle = vi.fn().mockResolvedValue(undefined);
      const subscriber: EventSubscriberDefinition<Event> = {
        name: "conversationProcess",
        eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
        handle: subscriberHandle,
      };

      // Wire BOTH into a real service on a real queue and commit an event. This
      // is the control: it proves this exact subscriber object is genuinely
      // registered and does fire for this event type, so the not-called
      // assertion below is about the replay path rather than about an orphan.
      const registry = new Map<string, JobRegistryEntry>();
      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore: createMockEventStore<Event>(),
        foldProjections: [fold],
        subscribers: [subscriber],
        globalQueue: createMemoryGlobalQueue(registry),
        globalJobRegistry: registry,
      });
      await service.storeEvents([makeEvent("evt-live")], context_);

      expect(subscriberHandle).toHaveBeenCalledTimes(1); // live dispatch reaches it
      expect(applied).toHaveLength(1);

      // Now rebuild the SAME fold through FoldAccumulator — the primitive every
      // production replay path (fold / map / optimized / state) constructs
      // directly. `ReplayConfig` carries only projections / mapProjections /
      // stateProjections: there is no field a subscriber could occupy, and the
      // accumulator has no seam that could dispatch one. If either ever grew
      // one, the count below moves and this fails.
      const replayed = [makeEvent("evt-replay-1"), makeEvent("evt-replay-2")];
      const accumulator = new FoldAccumulator(fold);
      for (const event of replayed) accumulator.apply(toReplayEvent(event));
      await accumulator.flush();

      expect(accumulator.processed).toBe(2);
      expect(applied).toHaveLength(3); // 1 live + 2 rebuilt
      // The rebuild wrote the fold…
      expect(fold.store.store).toHaveBeenCalled();
      // …and the subscriber is still on its single LIVE invocation: replay
      // added none.
      expect(subscriberHandle).toHaveBeenCalledTimes(1);
    });
  });

  describe("given event publication carries an active OTel trace", () => {
    it("keeps that context active in the subscriber handler and opens a subscriber span with tenant/pipeline/subscriber attributes", async () => {
      const eventStore = createMockEventStore<Event>();
      const registry = new Map<string, JobRegistryEntry>();
      const globalQueue = createMemoryGlobalQueue(registry);

      const subscriber: EventSubscriberDefinition<Event> = {
        name: "conversationProcess",
        eventTypes: [],
        handle: async () => {
          // Prove the queue-processing context is active here: the currently
          // active span must be the subscriber's own span, inside the trace.
          const active = trace.getSpan(context.active());
          expect(active).toBeDefined();
        },
      };

      const service = new EventSourcingService({
        pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
        aggregateType,
        eventStore,
        subscribers: [subscriber],
        globalQueue,
        globalJobRegistry: registry,
      });

      const tracer = trace.getTracer("test-publisher");
      const publishTraceId = await tracer.startActiveSpan(
        "event.publish",
        async (publishSpan) => {
          const traceId = publishSpan.spanContext().traceId;
          await service.storeEvents([makeEvent("evt-otel")], context_);
          publishSpan.end();
          return traceId;
        },
      );

      const spans = exporter.getFinishedSpans();
      const byName = (name: string): ReadableSpan | undefined =>
        spans.find((s) => s.name === name);

      const subscriberSpan = byName("EventSubscriber.handle");
      const queueSpan = byName("pipeline.process");

      expect(subscriberSpan).toBeDefined();
      expect(queueSpan).toBeDefined();

      // Same trace as the publication span → context survived publish → queue.
      expect(subscriberSpan!.spanContext().traceId).toBe(publishTraceId);
      expect(queueSpan!.spanContext().traceId).toBe(publishTraceId);

      // The subscriber span is a child of the queue-processing span, proving
      // the queue-processing context is active inside the handler.
      expect(subscriberSpan!.parentSpanContext?.spanId).toBe(
        queueSpan!.spanContext().spanId,
      );
      expect(subscriberSpan!.kind).toBe(SpanKind.INTERNAL);

      // Subscriber-specific span carries tenant / pipeline / subscriber ids.
      expect(subscriberSpan!.attributes).toMatchObject({
        "subscriber.name": "conversationProcess",
        "tenant.id": String(tenantId),
        "pipeline.name": TEST_CONSTANTS.PIPELINE_NAME,
      });
    });
  });
});
