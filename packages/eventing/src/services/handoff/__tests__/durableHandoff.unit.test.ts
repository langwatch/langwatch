/**
 * @vitest-environment node
 * A lane that fails to stage is recorded in the outbox and re-driven.
 * See specs/durable-handoff.feature.
 */
import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";
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
import { sealFoldProjection } from "../../../projections/sealedProjection.ts";
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
  return { service, drain: (now: number) => dispatcher.runOnce({ now }) };
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

describe("durable hand-off", () => {
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

  describe("given a fold whose first store throws", () => {
    /** @scenario "A fold that fails to stage is recorded and never re-staged as a late event" */
    it("records the lane and retires it dead rather than re-staging the event", async () => {
      const handoffStore = InMemoryProcessStore.createForTesting();
      const store = createMockFoldProjectionStore<{ count: number }>();
      vi.mocked(store.store).mockRejectedValueOnce(new Error("clickhouse refused"));
      const fold = createMockFoldProjectionDefinition("counter", {
        store,
        init: () => ({ count: 0 }),
        apply: (state: { count: number }) => ({ count: state.count + 1 }),
      });
      const { service, drain } = serviceWith({
        handoffStore,
        foldProjections: [sealFoldProjection(fold)],
      });

      await service.storeEvents([appended()], { tenantId });
      expect(await handoffRows(handoffStore)).toEqual([
        expect.objectContaining({
          intentType: "fold",
          payload: expect.objectContaining({ lane: "counter" }),
        }),
      ]);

      const report = await drain(Date.now());

      expect(report.dead).toHaveLength(1);
      expect(store.store).toHaveBeenCalledTimes(1);
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

      const counted = await register.getSingleMetricAsString("es_handoff_total");
      expect(counted).toContain(
        `pipeline_name="${pipelineName}",lane_kind="subscriber",outcome="unrecorded"`,
      );
    });
  });
});
