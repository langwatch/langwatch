/**
 * @vitest-environment node
 * A lane that fails to stage is recorded in the outbox and re-driven.
 * See specs/durable-handoff.feature.
 */
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Event } from "../../../domain/types.ts";
import type { ProcessManagerDefinition } from "../../../pipeline/processManagerDefinition.ts";
import {
  type IntentHandler,
  OutboxDispatcherService,
} from "../../../process-manager/outbox/outboxDispatcherService.ts";
import { ProcessRuntime } from "../../../process-manager/processRuntime.ts";
import { InMemoryProcessStore } from "../../../process-manager/stores/inMemoryProcessStore.ts";
import { ProjectionRegistry } from "../../../projections/projectionRegistry.ts";
import { sealFoldProjection, sealStateProjection } from "../../../projections/sealedProjection.ts";
import type {
  StateProjectionDefinition,
  StoredProjection,
} from "../../../projections/stateProjection.types.ts";
import type { EventSourcedQueueProcessor } from "../../../queues/index.ts";
import { EventStoreMemory } from "../../../stores/eventStoreMemory.ts";
import type { EventSubscriberDefinition } from "../../../subscribers/eventSubscriber.types.ts";
import {
  createMockFoldProjectionDefinition,
  createMockFoldProjectionStore,
  createMockMapProjectionDefinition,
  createTestEvent,
  createTestTenantId,
  parseTestEvent,
  TEST_CONSTANTS,
} from "../../__tests__/testHelpers.ts";
import { EventSourcingService } from "../../eventSourcingService.ts";
import type { EventSourcingServiceOptions } from "../../eventSourcingService.types.ts";
import { HANDOFF_PROCESS_NAME, handoffLaneKindSchema } from "../failedHandoff.ts";

const tenantId = createTestTenantId();
const aggregateType = TEST_CONSTANTS.AGGREGATE_TYPE;
const aggregateId = TEST_CONSTANTS.AGGREGATE_ID;
const pipelineName = TEST_CONSTANTS.PIPELINE_NAME;

interface Count {
  count: number;
  seen: string[];
  LastEventOccurredAt: number;
}

function countEvent(state: Count, event: Event): Count {
  return {
    count: state.count + 1,
    seen: [...state.seen, event.id],
    LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
  };
}

/** A fold store that keeps its one row and the applied-id set it was committed with. */
function foldStoreInMemory() {
  let row: { state: Count; applied: string[] } | null = null;
  const store = createMockFoldProjectionStore<Count>();
  store.getWithApplied = async () =>
    row
      ? { state: row.state, appliedEventIds: row.applied }
      : { state: null, appliedEventIds: [], miss: "absent" };
  vi.mocked(store.store).mockImplementation(async (state, context) => {
    row = { state, applied: [...(context.appliedEventIds ?? [])] };
  });
  return { store, current: () => row };
}

function serviceWith(
  options: Partial<EventSourcingServiceOptions<Event>> & { handoffStore: InMemoryProcessStore },
) {
  const eventStore = EventStoreMemory.createForTesting<Event>();
  const service = new EventSourcingService<Event>({
    parseEvent: parseTestEvent,
    pipelineName,
    aggregateType,
    allowedEventTypes: [TEST_CONSTANTS.EVENT_TYPE_1, TEST_CONSTANTS.EVENT_TYPE_2],
    eventStore,
    ...options,
  });
  const redeliver: IntentHandler = ({ message }) => service.redeliverHandoff({ message });
  const dispatcher = new OutboxDispatcherService({
    store: options.handoffStore,
    handlers: Object.fromEntries(handoffLaneKindSchema.options.map((kind) => [kind, redeliver])),
    processNames: [HANDOFF_PROCESS_NAME],
  });
  return { service, eventStore, drain: (now: number) => dispatcher.runOnce({ now }) };
}

function handoffRows(store: InMemoryProcessStore) {
  return store.findMessagesByRef({
    ref: {
      processName: HANDOFF_PROCESS_NAME,
      projectId: tenantId,
      processKey: `${pipelineName}:${aggregateId}`,
    },
  });
}

const appended = () => createTestEvent(aggregateId, aggregateType, tenantId);
const appendedAt = (createdAt: number) =>
  createTestEvent(aggregateId, aggregateType, tenantId, TEST_CONSTANTS.EVENT_TYPE_1, createdAt);

let meter = createRecordingMeterProvider();

describe("durable hand-off", () => {
  beforeEach(() => {
    meter = createRecordingMeterProvider();
    meter.install();
  });
  afterEach(() => meter.uninstall());

  describe("given every lane stages", () => {
    /** @scenario "A successful hand-off writes nothing to the outbox" */
    it("writes no hand-off row", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const handle = vi.fn().mockResolvedValue(undefined);
      const { service } = serviceWith({
        handoffStore,
        subscribers: [{ name: "healthy", eventTypes: [], handle }],
      });

      await service.storeEvents([appended()], { tenantId });

      expect(handle).toHaveBeenCalledTimes(1);
      expect(await handoffRows(handoffStore)).toEqual([]);
    });
  });

  describe("given a subscriber whose first delivery throws", () => {
    /** @scenario "A subscriber that fails to stage is recorded and re-driven exactly once" */
    it("records the lane and re-drives it exactly once", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const handled: string[] = [];
      const handle = vi
        .fn<EventSubscriberDefinition<Event>["handle"]>()
        .mockRejectedValueOnce(new Error("redis unreachable"))
        .mockImplementation(async (event) => {
          handled.push(event.id);
        });
      const { service, drain } = serviceWith({
        handoffStore,
        subscribers: [{ name: "notify", eventTypes: [], handle }],
      });
      const event = appended();

      await expect(service.storeEvents([event], { tenantId })).resolves.toBeUndefined();
      expect(await handoffRows(handoffStore)).toEqual([
        expect.objectContaining({
          intentType: "subscriber",
          payload: expect.objectContaining({ lane: "notify", eventId: event.id }),
        }),
      ]);

      const first = await drain(Date.now());
      const second = await drain(Date.now() + 120_000);

      expect(first.dispatched).toHaveLength(1);
      expect(second.dispatched).toHaveLength(0);
      expect(handled).toEqual([event.id]);
    });
  });

  describe("given a process manager whose first inbox commit throws", () => {
    /** @scenario "A process manager inbox that fails to stage is re-driven and commits once" */
    it("re-drives the inbox and evolves on the event exactly once", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const stateSchema = z.object({ seen: z.number() });
      const definition: ProcessManagerDefinition = {
        config: {
          name: "counter",
          state: { seen: 0 },
          stateSchema,
          eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
          handlers: {
            [TEST_CONSTANTS.EVENT_TYPE_1]: (state) => ({
              state: { seen: stateSchema.parse(state).seen + 1 },
            }),
          },
          intents: {},
        },
      };
      const runtime = new ProcessRuntime({ store: handoffStore, consumersEnabled: false });
      const { subscribers } = runtime.registerPipeline<Event>({
        pipelineName,
        processManagers: new Map([["counter", definition]]),
      });
      vi.spyOn(handoffStore, "commit").mockRejectedValueOnce(new Error("postgres down"));
      const { service, drain } = serviceWith({ handoffStore, subscribers });

      await service.storeEvents([appended()], { tenantId });
      expect(await handoffRows(handoffStore)).toEqual([
        expect.objectContaining({
          intentType: "subscriber",
          payload: expect.objectContaining({ lane: "pm:counter" }),
        }),
      ]);

      await drain(Date.now());
      await drain(Date.now() + 120_000);

      const instance = await handoffStore.findByRef({
        ref: { processName: "counter", projectId: tenantId, processKey: aggregateId },
      });
      expect(instance?.state).toEqual({ seen: 1 });
    });
  });

  describe("given a fold that missed an event between two it folded", () => {
    /** @scenario "A fold that missed an event is rebuilt and ends equal to a full replay" */
    it("rebuilds the aggregate to what a full replay of the log folds", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const { store, current } = foldStoreInMemory();
      const fold = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0, seen: [], LastEventOccurredAt: 0 }),
        apply: countEvent,
      });
      const { service, eventStore, drain } = serviceWith({
        handoffStore,
        foldProjections: [sealFoldProjection(fold)],
      });

      await service.storeEvents([appendedAt(1_000)], { tenantId });
      vi.mocked(store.store).mockRejectedValueOnce(new Error("clickhouse refused"));
      await service.storeEvents([appendedAt(2_000)], { tenantId });
      await service.storeEvents([appendedAt(3_000)], { tenantId });
      expect(current()?.state.count).toBe(2);
      expect(await handoffRows(handoffStore)).toEqual([
        expect.objectContaining({
          intentType: "fold",
          payload: expect.objectContaining({ lane: "counter" }),
        }),
      ]);

      const report = await drain(Date.now());

      const log = await eventStore.getEvents({ aggregateId, context: { tenantId }, aggregateType });
      const fullReplay = log.reduce(countEvent, { count: 0, seen: [], LastEventOccurredAt: 0 });
      expect(report.dispatched).toHaveLength(1);
      expect(current()?.state).toEqual(fullReplay);
      expect(current()?.applied).toEqual(log.map((event) => event.id));
    });
  });

  describe("given a fold whose key spans aggregates", () => {
    /** @scenario "A keyed lane that does not accept redelivery cannot rebuild from one aggregate and retires dead" */
    it("retires the row dead rather than rebuilding from one aggregate", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const { store } = foldStoreInMemory();
      vi.mocked(store.store).mockRejectedValueOnce(new Error("clickhouse refused"));
      const fold = createMockFoldProjectionDefinition("perOrganization", { store });
      fold.key = () => "organization-1";
      const { service, drain } = serviceWith({
        handoffStore,
        foldProjections: [sealFoldProjection(fold)],
      });

      await service.storeEvents([appended()], { tenantId });
      const report = await drain(Date.now());

      expect(report.dead).toHaveLength(1);
      expect(store.store).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a fold whose key spans aggregates and that accepts redelivery", () => {
    /** @scenario "A keyed lane that accepts redelivery gets the single event re-sent" */
    it("folds the missed event onto the live lane once without rebuilding", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const { store, current } = foldStoreInMemory();
      vi.mocked(store.store).mockRejectedValueOnce(new Error("clickhouse refused"));
      const fold = createMockFoldProjectionDefinition("perOrganization", {
        store,
        init: () => ({ count: 0, seen: [], LastEventOccurredAt: 0 }),
        apply: countEvent,
      });
      fold.key = () => "organization-1";
      fold.options = { resendOnRedelivery: true };
      const eventLoader = vi.fn(async () => []);
      fold.eventLoader = eventLoader;
      const { service, drain } = serviceWith({
        handoffStore,
        foldProjections: [sealFoldProjection(fold)],
      });
      const event = appended();

      await service.storeEvents([event], { tenantId });
      expect(current()).toBeNull();
      const report = await drain(Date.now());

      expect(report.dispatched).toHaveLength(1);
      expect(report.dead).toHaveLength(0);
      expect(current()?.state.seen).toEqual([event.id]);
      expect(eventLoader).not.toHaveBeenCalled();
    });
  });

  describe("given a state projection that missed an event between two it applied", () => {
    /** @scenario "A state projection that missed an event is rebuilt from the aggregate's log" */
    it("rebuilds the row with every event and the newest cursor", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const held: { row?: StoredProjection<{ count: number }> } = {};
      const projection: StateProjectionDefinition<{ count: number }, Event> = {
        name: "counterRow",
        version: "2026-09-29",
        eventTypes: [],
        init: () => ({ count: 0 }),
        apply: (state) => ({ count: state.count + 1 }),
        store: {
          get: async () =>
            held.row ? { kind: "folded", projection: held.row } : { kind: "empty" },
          store: async (stored) => {
            held.row = stored;
          },
        },
      };
      const failingOnce = vi.spyOn(projection.store, "store");
      const { service, drain } = serviceWith({
        handoffStore,
        stateProjections: [sealStateProjection(projection)],
      });

      await service.storeEvents([appendedAt(1_000)], { tenantId });
      failingOnce.mockRejectedValueOnce(new Error("postgres refused"));
      await service.storeEvents([appendedAt(2_000)], { tenantId });
      const last = appendedAt(3_000);
      await service.storeEvents([last], { tenantId });
      expect(held.row?.state.count).toBe(2);

      await drain(Date.now());

      expect(held.row?.state.count).toBe(3);
      expect(held.row?.cursor.eventId).toBe(last.id);
    });
  });

  describe("given a state projection that missed a re-send the log read collapses into an earlier copy", () => {
    type Requested = { count: number; lastRequestedAt: number | null };

    const setUp = () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const held: { row?: StoredProjection<Requested> } = {};
      const projection: StateProjectionDefinition<Requested, Event> = {
        name: "requestedRow",
        version: "2026-09-29",
        eventTypes: [],
        init: () => ({ count: 0, lastRequestedAt: null }),
        apply: (state, event) => ({ count: state.count + 1, lastRequestedAt: event.occurredAt }),
        store: {
          get: async () =>
            held.row ? { kind: "folded", projection: held.row } : { kind: "empty" },
          store: async (stored) => {
            held.row = stored;
          },
        },
      };
      const store = vi.spyOn(projection.store, "store");
      const harness = serviceWith({
        handoffStore,
        stateProjections: [sealStateProjection(projection)],
      });
      return { ...harness, held, store };
    };

    /** A first request applied, and the projection's next update refused once. */
    const afterAppliedRequestThenRefusal = async () => {
      const harness = setUp();
      const first = { ...appendedAt(1_000), occurredAt: 1_000, idempotencyKey: "bootstrap" };
      await harness.service.storeEvents([first], { tenantId });
      harness.store.mockRejectedValueOnce(new Error("postgres refused"));
      return { ...harness, first };
    };

    /** The log read: ascending, first row per idempotency key, as `deduplicateEvents` keeps it. */
    const readingFirstCopyOnly = (
      eventStore: ReturnType<typeof setUp>["eventStore"],
      hidden: readonly string[],
    ) => {
      const getEvents = eventStore.getEvents.bind(eventStore);
      vi.spyOn(eventStore, "getEvents").mockImplementation(async (input) =>
        (await getEvents(input)).filter((event) => !hidden.includes(event.id)),
      );
    };

    /** @scenario "A state projection that missed a re-send under a held key rebuilds from the log's copy" */
    it("folds the re-send in at its own position instead of waiting for its id", async () => {
      const { service, eventStore, drain, held } = await afterAppliedRequestThenRefusal();
      const resend = { ...appendedAt(2_000), occurredAt: 2_000, idempotencyKey: "bootstrap" };
      await service.storeEvents([resend], { tenantId });
      readingFirstCopyOnly(eventStore, [resend.id]);

      const redriven = await drain(Date.now());

      expect(redriven.dispatched).toHaveLength(1);
      expect(held.row?.state).toEqual({ count: 2, lastRequestedAt: resend.occurredAt });
      expect(held.row?.cursor.eventId).toBe(resend.id);
    });

    it("rebuilds from the log alone once the read returns the re-send itself", async () => {
      const { service, eventStore, drain, held } = await afterAppliedRequestThenRefusal();
      const resend = { ...appendedAt(2_000), occurredAt: 2_000, idempotencyKey: "bootstrap" };
      await service.storeEvents([resend], { tenantId });
      // A merge in the same partition keeps the newer row (the highest EventTimestamp).
      vi.spyOn(eventStore, "getEvents").mockResolvedValue([resend]);

      await drain(Date.now());

      expect(held.row?.state).toEqual({ count: 1, lastRequestedAt: resend.occurredAt });
    });

    it("still retries a missed event whose key the log does not hold yet", async () => {
      const { service, eventStore, drain, held, first } = await afterAppliedRequestThenRefusal();
      const other = { ...appendedAt(2_000), occurredAt: 2_000, idempotencyKey: "manual:2000" };
      await service.storeEvents([other], { tenantId });
      readingFirstCopyOnly(eventStore, [other.id]);

      const redriven = await drain(Date.now());

      expect(redriven.dispatched).toHaveLength(0);
      expect(held.row?.state).toEqual({ count: 1, lastRequestedAt: first.occurredAt });
    });
  });

  describe("given a global map projection on a registry that is not routing", () => {
    /** @scenario "A global lane missed while the registry is closed is re-driven once it routes" */
    it("re-drives the global lane once the registry routes", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const registry = new ProjectionRegistry({ parseEvent: parseTestEvent });
      registry.registerMapProjection(
        createMockMapProjectionDefinition("meter", { eventTypes: [] }),
      );
      const { service, drain } = serviceWith({ handoffStore, globalRegistry: registry });
      const event = appended();

      await service.storeEvents([event], { tenantId });
      expect(await handoffRows(handoffStore)).toEqual([
        expect.objectContaining({
          intentType: "map",
          payload: expect.objectContaining({ scope: "global", lane: "meter" }),
        }),
      ]);

      const sendBatch = vi.fn().mockResolvedValue(undefined);
      const globalQueue: EventSourcedQueueProcessor<Record<string, unknown>> = {
        send: vi.fn().mockResolvedValue(undefined),
        sendBatch,
        close: vi.fn().mockResolvedValue(undefined),
        waitUntilReady: vi.fn().mockResolvedValue(undefined),
      };
      registry.initialize(globalQueue, new Map());
      await drain(Date.now());
      await drain(Date.now() + 120_000);

      expect(sendBatch).toHaveBeenCalledTimes(1);
      expect(sendBatch.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ id: event.id })]);
    });
  });

  describe("given a hand-off outbox that refuses the write", () => {
    /** @scenario "A failed hand-off the outbox cannot record is counted as lost" */
    it("keeps the append and counts the loss as unrecorded", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      vi.spyOn(handoffStore, "appendIntents").mockRejectedValue(new Error("postgres down"));
      const handle = vi.fn().mockRejectedValue(new Error("redis unreachable"));
      const { service } = serviceWith({
        handoffStore,
        subscribers: [{ name: "lossy", eventTypes: [], handle }],
      });

      await expect(service.storeEvents([appended()], { tenantId })).resolves.toBeUndefined();

      expect(
        meter.valueOf("es_handoff_total", {
          pipeline_name: pipelineName,
          lane_kind: "subscriber",
          outcome: "unrecorded",
        }),
      ).toBe(1);
    });
  });
});
