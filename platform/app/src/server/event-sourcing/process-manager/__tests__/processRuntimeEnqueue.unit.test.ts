/**
 * @vitest-environment node
 *
 * What a process manager may declare about the staging of its own delivery
 * (ADR-069 invariant 4), proven at the fan-out seam with the real
 * ProjectionRouter — so "no job" means the router genuinely never handed one
 * over, not that a stub was not called.
 *
 * The regression these pin: the generated subscriber used to carry NO options
 * at all, so a process mounted on a high-volume event minted a GroupQueue job
 * and a `ProcessManagerInbox` row per event and ran its narrowing only after
 * dequeue. The reactors these processes replaced gated before enqueue.
 *
 * @see dev/docs/adr/069-payload-cost-doctrine.md
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { buildProcessManager } from "../../pipeline/processBuilder";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "../../pipelines/automations/schemas/constants";
import type { AutomationEvent } from "../../pipelines/automations/schemas/events";
import { ProjectionRouter } from "../../projections/projectionRouter";
import {
  createTestAggregateType,
  createTestEventStoreReadContext,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { QueueManager } from "../../services/queues/queueManager";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import { ProcessRuntime } from "../processRuntime";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore";

const aggregateType = createTestAggregateType();
const tenantId = createTenantId("project-1");
const readContext = createTestEventStoreReadContext(tenantId);

interface CountState {
  count: number;
}

/**
 * A process mounted on one event type, optionally declaring an enqueue gate.
 * `marker` is the only thing the filter looks at, so a declined event and an
 * accepted one differ in nothing else.
 */
function buildCountingProcess({
  name,
  filter,
  delay,
  deduplication,
}: {
  name: string;
  filter?: (event: AutomationEvent) => boolean;
  delay?: number;
  deduplication?: { makeId: (event: AutomationEvent) => string; ttlMs: number };
}) {
  return buildProcessManager<AutomationEvent>({
    name,
    applier: (pm) => {
      const built = pm
        .state<CountState>({ count: 0 })
        .intent("noop", z.object({}), async () => {})
        .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state: CountState) => ({
          state: { count: state.count + 1 },
        }));
      return filter || delay || deduplication
        ? built.enqueue({ filter, delay, deduplication })
        : built;
    },
  });
}

function generatedSubscriber(
  definition: ReturnType<typeof buildCountingProcess>,
  store: InMemoryProcessStore,
): EventSubscriberDefinition<AutomationEvent> {
  const runtime = new ProcessRuntime({ store, consumersEnabled: false });
  const [subscriber] = runtime.registerPipeline<AutomationEvent>({
    pipelineName: "automations",
    processManagers: new Map([[definition.config.name, definition]]),
  }).subscribers;
  return subscriber!;
}

/**
 * The real router with no global queue: `hasSubscriberQueues()` is false, so a
 * staged event runs the subscriber inline. The enqueue seam still applies, so
 * "the handler ran" and "a job was staged" are the same observation.
 */
function makeRouter(subscriber: EventSubscriberDefinition<AutomationEvent>) {
  const router = new ProjectionRouter<Event>(
    aggregateType,
    TEST_CONSTANTS.PIPELINE_NAME,
    new QueueManager<Event>({
      aggregateType,
      pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    }),
  );
  router.registerEventSubscriber(
    subscriber as unknown as EventSubscriberDefinition<Event>,
  );
  return router;
}

function matchEvent({ marker }: { marker: string }): Event {
  return {
    id: `evt-${marker}`,
    idempotencyKey: `trigger-1:${marker}`,
    aggregateId: "trigger-1",
    aggregateType,
    tenantId,
    createdAt: 1_000,
    occurredAt: 1_000,
    type: TRIGGER_MATCH_RECORDED_EVENT_TYPE,
    version: "2026-07-18",
    data: {
      triggerId: "trigger-1",
      traceId: `trace-${marker}`,
      action: "SEND_EMAIL",
      actionClass: "notify",
      traceDebounceMs: 30_000,
      notificationCadence: "immediate",
      marker,
    },
  } as unknown as Event;
}

async function committedCount(store: InMemoryProcessStore, name: string) {
  const instance = await store.findByRef<CountState>({
    ref: { processName: name, projectId: tenantId, processKey: "trigger-1" },
  });
  return instance?.state.count ?? null;
}

describe("process-manager enqueue declaration", () => {
  describe("given a process manager that declares an enqueue filter", () => {
    describe("when an event the filter declines is dispatched", () => {
      /** @scenario "deferred work declines an irrelevant event before it is queued" */
      it("stages no job, so the process is never created", async () => {
        const store = new InMemoryProcessStore();
        const definition = buildCountingProcess({
          name: "filteredProcess",
          filter: (event) =>
            (event.data as { marker?: string }).marker === "keep",
        });
        const router = makeRouter(generatedSubscriber(definition, store));

        await router.dispatch([matchEvent({ marker: "drop" })], readContext);

        expect(await committedCount(store, "filteredProcess")).toBeNull();
      });
    });

    describe("when an event the filter accepts is dispatched", () => {
      it("evolves the process exactly once", async () => {
        const store = new InMemoryProcessStore();
        const definition = buildCountingProcess({
          name: "acceptedProcess",
          filter: (event) =>
            (event.data as { marker?: string }).marker === "keep",
        });
        const router = makeRouter(generatedSubscriber(definition, store));

        await router.dispatch(
          [matchEvent({ marker: "drop" }), matchEvent({ marker: "keep" })],
          readContext,
        );

        expect(await committedCount(store, "acceptedProcess")).toBe(1);
      });
    });
  });

  describe("given a process manager that declares a dedup window and a delay", () => {
    it("carries both onto the generated subscriber", () => {
      const definition = buildCountingProcess({
        name: "windowedProcess",
        delay: 5_000,
        deduplication: {
          makeId: (event) => `windowed:${String(event.aggregateId)}`,
          ttlMs: 15_000,
        },
      });

      const subscriber = generatedSubscriber(
        definition,
        new InMemoryProcessStore(),
      );

      expect(subscriber.options?.delay).toBe(5_000);
      const dedup = subscriber.options?.deduplication;
      if (typeof dedup !== "object") {
        throw new Error("expected a deduplication config");
      }
      expect(dedup.ttlMs).toBe(15_000);
      expect(dedup.makeId(matchEvent({ marker: "a" }) as AutomationEvent)).toBe(
        "windowed:trigger-1",
      );
    });
  });

  describe("given a process manager that declares no enqueue options", () => {
    it("generates a subscriber that gates nothing", () => {
      const definition = buildCountingProcess({ name: "ungatedProcess" });

      const subscriber = generatedSubscriber(
        definition,
        new InMemoryProcessStore(),
      );

      expect(subscriber.options).toBeUndefined();
    });
  });

  describe("given enqueue options are declared twice", () => {
    it("refuses the definition rather than silently keeping one", () => {
      expect(() =>
        buildProcessManager<AutomationEvent>({
          name: "doubleDeclared",
          applier: (pm) =>
            pm
              .state<CountState>({ count: 0 })
              .intent("noop", z.object({}), async () => {})
              .on(TRIGGER_MATCH_RECORDED_EVENT_TYPE, (state: CountState) => ({
                state,
              }))
              .enqueue({ delay: 1_000 })
              .enqueue({ delay: 2_000 }),
        }),
      ).toThrow(/already declares enqueue options/);
    });
  });
});
