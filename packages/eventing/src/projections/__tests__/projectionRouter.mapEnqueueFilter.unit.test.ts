/**
 * @vitest-environment node
 * @unit
 *
 * The enqueue-time map-projection contract (payload-cost doctrine invariant 4
 * — ADR-069), proven at the fan-out seam through the real ProjectionRouter.
 *
 * Guarantees under test:
 *   - a `filter` returning false mints no queue job at all, so the cost of an
 *     irrelevant event is a predicate call rather than a job, a payload
 *     deserialization and a worker slot;
 *   - the same gate applies on the inline (queue-less) path, so a test that
 *     drives the router inline sees production's set of mapped records;
 *   - a filter that raises admits the event rather than dropping the record,
 *     because a map projection's fan-out is never replayed; and
 *   - both outcomes are counted on `es_map_projection_enqueue_total`.
 *
 * @see specs/coding-agent/context-economics.feature
 */
import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types";
import type { EventSourcedQueueProcessor } from "../../queues";
import {
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { type JobRegistryEntry, QueueManager } from "../../services/queues/queueManager";
import type { AppendStore, MapProjectionDefinition } from "../mapProjection.types";
import { ProjectionRouter } from "../projectionRouter";

const aggregateType = createTestAggregateType();
const tenantId = createTestTenantId();
const readContext = createTestEventStoreReadContext(tenantId);
const PROJECTION_NAME = "seamMap";

function makeEvent(marker: string): Event {
  return createTestEvent(
    TEST_CONSTANTS.AGGREGATE_ID,
    aggregateType,
    tenantId,
    TEST_CONSTANTS.EVENT_TYPE_1,
    1000,
    "2025-12-17",
    { marker },
    `evt-${marker}`,
  );
}

/** The record a mapped event becomes; its identity is all these tests read. */
interface SeamRecord {
  marker: string;
}

function makeProjection({
  filter,
  appended,
}: {
  filter?: (event: Event) => boolean;
  appended: SeamRecord[];
}): MapProjectionDefinition<SeamRecord, Event> {
  const store: AppendStore<SeamRecord> = {
    append: async (record) => {
      appended.push(record);
    },
  };
  return {
    name: PROJECTION_NAME,
    eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
    map: (event) => {
      const marker = (event.data as { marker?: string }).marker ?? "";
      // The projection's own answer, which the filter restates: only `keep`
      // events become records.
      return marker.startsWith("keep") ? { marker } : null;
    },
    store,
    ...(filter ? { options: { enqueue: { filter } } } : {}),
  };
}

/**
 * A router whose map lane really enqueues. The global queue is a spy rather
 * than Redis: what these tests measure is how many jobs the seam handed over,
 * which is decided before the queue implementation matters.
 */
function makeQueuedRouter(projection: MapProjectionDefinition<SeamRecord, Event>) {
  const sent: Event[][] = [];
  const globalQueue = {
    send: async (payload: Record<string, unknown>) => {
      sent.push([payload as unknown as Event]);
    },
    sendBatch: async (payloads: Record<string, unknown>[]) => {
      sent.push(payloads as unknown as Event[]);
    },
    close: async () => undefined,
    waitUntilReady: async () => undefined,
  } as unknown as EventSourcedQueueProcessor<Record<string, unknown>>;

  const queueManager = new QueueManager<Event>({
    aggregateType,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    globalQueue,
    globalJobRegistry: new Map<string, JobRegistryEntry>(),
  });
  const router = new ProjectionRouter<Event>(
    aggregateType,
    TEST_CONSTANTS.PIPELINE_NAME,
    queueManager,
  );
  router.registerMapProjection(projection);
  router.initializeMapQueues();

  return {
    router,
    /** Every event the seam actually handed to the queue, flattened. */
    queued: () => sent.flat(),
  };
}

/** A router with no global queue: `hasHandlerQueues()` is false, so map runs inline. */
function makeInlineRouter(projection: MapProjectionDefinition<SeamRecord, Event>) {
  const router = new ProjectionRouter<Event>(
    aggregateType,
    TEST_CONSTANTS.PIPELINE_NAME,
    new QueueManager<Event>({
      aggregateType,
      pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    }),
  );
  router.registerMapProjection(projection);
  return router;
}

async function enqueueOutcomeCount(outcome: string): Promise<number> {
  const metric = register.getSingleMetric("es_map_projection_enqueue_total");
  if (!metric) return 0;
  const snapshot = (await metric.get()) as {
    values: Array<{ labels: Record<string, string>; value: number }>;
  };
  return snapshot.values
    .filter(
      (value) =>
        value.labels.projection_name === PROJECTION_NAME && value.labels.outcome === outcome,
    )
    .reduce((sum, value) => sum + value.value, 0);
}

describe("map projection enqueue-time contract", () => {
  describe("given a map projection that declares an enqueue filter", () => {
    describe("when a batch of events it maps to nothing is dispatched", () => {
      /** @scenario "A contribution the fact table declines mints no queue job" */
      it("mints a job only for the events it would map", async () => {
        const before = {
          queued: await enqueueOutcomeCount("queued"),
          filtered: await enqueueOutcomeCount("filtered"),
        };
        const appended: SeamRecord[] = [];
        const { router, queued } = makeQueuedRouter(
          makeProjection({
            appended,
            filter: (event) =>
              String((event.data as { marker?: string }).marker).startsWith("keep"),
          }),
        );

        await router.dispatch(
          [
            makeEvent("keep-1"),
            makeEvent("drop-1"),
            makeEvent("drop-2"),
            makeEvent("keep-2"),
            makeEvent("drop-3"),
          ],
          readContext,
        );

        expect(queued().map((event) => event.id)).toEqual(["evt-keep-1", "evt-keep-2"]);
        expect(await enqueueOutcomeCount("queued")).toBe(before.queued + 2);
        expect(await enqueueOutcomeCount("filtered")).toBe(before.filtered + 3);
      });
    });

    describe("when the same events are dispatched with no queue behind the lane", () => {
      it("applies the same gate inline, so both modes map the same records", async () => {
        const appended: SeamRecord[] = [];
        const map = vi.fn((event: Event) =>
          (event.data as { marker?: string }).marker?.startsWith("keep")
            ? { marker: (event.data as { marker: string }).marker }
            : null,
        );
        const projection = makeProjection({
          appended,
          filter: (event) => String((event.data as { marker?: string }).marker).startsWith("keep"),
        });
        const router = makeInlineRouter({ ...projection, map });

        await router.dispatch(
          [makeEvent("keep-1"), makeEvent("drop-1"), makeEvent("drop-2")],
          readContext,
        );

        expect(appended).toEqual([{ marker: "keep-1" }]);
        // The declined events never reached the executor at all.
        expect(map).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the filter raises", () => {
      /**
       * The opposite call from the subscriber seam, and deliberately so: a
       * subscriber's job is the only carrier of its side effect, while this
       * filter is a restatement of what `map()` already decides. Admitting on a
       * throw costs one job that writes nothing; declining would drop a fact
       * row that is never replayed.
       */
      it("admits the event rather than dropping the record", async () => {
        const appended: SeamRecord[] = [];
        const { router, queued } = makeQueuedRouter(
          makeProjection({
            appended,
            filter: () => {
              throw new Error("filter blew up");
            },
          }),
        );

        await expect(router.dispatch([makeEvent("keep-1")], readContext)).resolves.toBeUndefined();
        expect(queued().map((event) => event.id)).toEqual(["evt-keep-1"]);
      });
    });
  });

  describe("given a map projection with no enqueue filter", () => {
    describe("when declared event types are dispatched", () => {
      it("queues every event of its declared types, unchanged", async () => {
        const appended: SeamRecord[] = [];
        const { router, queued } = makeQueuedRouter(makeProjection({ appended }));

        await router.dispatch([makeEvent("keep-1"), makeEvent("drop-1")], readContext);

        expect(queued().map((event) => event.id)).toEqual(["evt-keep-1", "evt-drop-1"]);
      });
    });
  });
});
