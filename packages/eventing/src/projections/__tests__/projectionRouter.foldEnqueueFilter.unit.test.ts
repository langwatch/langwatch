/**
 * @vitest-environment node
 * Enqueue-time fold contract, the map's twin: `filter` false mints no fold job;
 * one that raises admits the event, since declining could drop a count.
 * Spec: packages/eventing/specs/peer-projection.feature
 */
import { describe, expect, it } from "vitest";

import type { Event } from "../../domain/types.ts";
import type { EventSourcedQueueProcessor } from "../../queues/index.ts";
import {
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
  parseTestEvent,
} from "../../services/__tests__/testHelpers.ts";
import { type JobRegistryEntry, QueueManager } from "../../services/queues/queueManager.ts";
import type { FoldProjectionDefinition } from "../foldProjection.types.ts";
import { ProjectionRouter } from "../projectionRouter.ts";

const aggregateType = createTestAggregateType();
const tenantId = createTestTenantId();
const readContext = createTestEventStoreReadContext(tenantId);

interface Markers {
  markers: string[];
  LastEventOccurredAt: number;
}

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

const markerOf = (event: Event): string => String((event.data as { marker?: string }).marker);

function makeFold(filter?: (event: Event) => boolean): {
  fold: FoldProjectionDefinition<Markers, Event>;
  stored: () => Markers | undefined;
} {
  let row: Markers | undefined;
  return {
    stored: () => row,
    fold: {
      name: "seamFold",
      version: "2026-11-23",
      eventTypes: [TEST_CONSTANTS.EVENT_TYPE_1],
      init: () => ({ markers: [], LastEventOccurredAt: 0 }),
      // Deliberately not gated, so a declined event that reached apply would show.
      apply: (state, event) => ({
        markers: [...state.markers, markerOf(event)],
        LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
      }),
      store: {
        store: async (state) => {
          row = state;
        },
        get: async () => (row ? { kind: "folded", state: row } : { kind: "empty" }),
      },
      LastEventOccurredAtKey: "LastEventOccurredAt",
      ...(filter ? { options: { enqueue: { filter } } } : {}),
    },
  };
}

/** A router whose fold lane really enqueues onto a spy global queue. */
function makeQueuedRouter(fold: FoldProjectionDefinition<Markers, Event>) {
  const sent: Record<string, unknown>[] = [];
  const globalQueue: EventSourcedQueueProcessor<Record<string, unknown>> = {
    send: async (payload: Record<string, unknown>) => {
      sent.push(payload);
    },
    sendBatch: async (payloads: Record<string, unknown>[]) => {
      sent.push(...payloads);
    },
    close: async () => undefined,
    waitUntilReady: async () => undefined,
  };
  const router = new ProjectionRouter<Event>({
    aggregateType,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    queueManager: new QueueManager<Event>({
      parseEvent: parseTestEvent,
      aggregateType,
      pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
      globalQueue,
      globalJobRegistry: new Map<string, JobRegistryEntry>(),
    }),
  });
  router.registerFoldProjection(fold);
  router.initializeFoldQueues();
  return { router, queued: () => sent.map((job) => job.id) };
}

/** A router with no global queue, so the fold runs inline. */
function makeInlineRouter(fold: FoldProjectionDefinition<Markers, Event>) {
  const router = new ProjectionRouter<Event>({
    aggregateType,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    queueManager: new QueueManager<Event>({
      parseEvent: parseTestEvent,
      aggregateType,
      pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    }),
  });
  router.registerFoldProjection(fold);
  return router;
}

const keepOnly = (event: Event) => markerOf(event).startsWith("keep");

describe("fold projection enqueue-time contract", () => {
  describe("given a fold that declares an enqueue filter", () => {
    describe("when a batch mixing declined and taken events is dispatched", () => {
      it("stages a fold job only for the events the filter takes", async () => {
        const { router, queued } = makeQueuedRouter(makeFold(keepOnly).fold);

        await router.dispatch(
          [makeEvent("keep-1"), makeEvent("drop-1"), makeEvent("keep-2"), makeEvent("drop-2")],
          readContext,
        );

        expect(queued()).toEqual(["evt-keep-1", "evt-keep-2"]);
      });
    });

    describe("when the same events are dispatched with no queue behind the lane", () => {
      it("applies the same gate inline, so declined events never reach apply", async () => {
        const { fold, stored } = makeFold(keepOnly);
        const router = makeInlineRouter(fold);

        await router.dispatch([makeEvent("drop-1"), makeEvent("keep-1")], readContext);

        expect(stored()?.markers).toEqual(["keep-1"]);
      });
    });

    describe("when the filter raises", () => {
      it("admits the event rather than dropping the count", async () => {
        const { router, queued } = makeQueuedRouter(
          makeFold(() => {
            throw new Error("filter blew up");
          }).fold,
        );

        expect(await router.dispatch([makeEvent("keep-1")], readContext)).toEqual([]);
        expect(queued()).toEqual(["evt-keep-1"]);
      });
    });
  });

  describe("given a fold with no enqueue filter", () => {
    describe("when declared event types are dispatched", () => {
      it("stages every event of its declared types", async () => {
        const { router, queued } = makeQueuedRouter(makeFold().fold);

        await router.dispatch([makeEvent("keep-1"), makeEvent("drop-1")], readContext);

        expect(queued()).toEqual(["evt-keep-1", "evt-drop-1"]);
      });
    });
  });
});
