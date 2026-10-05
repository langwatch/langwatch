/**
 * @vitest-environment node
 *
 * Spec: packages/eventing/specs/own-event-store.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventUtils } from "../../utils/event.utils.ts";
import type { EventStore } from "../eventStore.types.ts";
import { EventStoreMemory } from "../eventStoreMemory.ts";
import { EventStoreProducerOnly } from "../eventStoreProducerOnly.ts";
import { PipelineEventStore } from "../pipelineEventStore.ts";

const TENANT = "organization-1";
const AGGREGATE_ID = "connection-1";
let clock = 1_759_651_200_000;

const openedEventSchema = testEventSchema("own.connection.opened", z.object({ note: z.string() }));
const renamedEventSchema = testEventSchema(
  "own.connection.renamed",
  z.object({ note: z.string() }),
);
type OpenedEvent = z.infer<typeof openedEventSchema>;
type ConnectionEvent = OpenedEvent | z.infer<typeof renamedEventSchema>;

function connectionPipeline() {
  return definePipeline({
    name: "own_connections",
    aggregate: defineAggregate({ type: "own_connection" }),
  })
    .withEvents([openedEventSchema, renamedEventSchema])
    .build();
}

function eventOf({
  type,
  aggregateType = "own_connection",
  note,
}: {
  type: ConnectionEvent["type"];
  aggregateType?: string;
  note: string;
}): Event {
  return EventUtils.createEvent({
    aggregateType,
    aggregateId: AGGREGATE_ID,
    tenantId: createTenantId(TENANT),
    type,
    version: "2026-10-05",
    data: { note },
    createdAt: (clock += 1000),
  });
}

const isConnectionEvent = (event: unknown): event is ConnectionEvent =>
  openedEventSchema.validate(event) || renamedEventSchema.validate(event);

const isOpenedEvent = (event: unknown): event is OpenedEvent => openedEventSchema.validate(event);

function boundStore(log: EventStore = EventStoreMemory.createForTesting()) {
  const store = PipelineEventStore.create({ pipeline: "own_connections", log: () => log });
  store.bindTo(connectionPipeline());
  return { store, log };
}

function readAll(store: PipelineEventStore) {
  return store.read({ tenantId: TENANT, aggregateId: AGGREGATE_ID, accepts: isConnectionEvent });
}

describe("PipelineEventStore", () => {
  describe("given a store bound to the aggregate its definition declares", () => {
    /** @scenario "A pipeline appends events to its own aggregate and reads them back" */
    it("answers what it appended, oldest first", async () => {
      const { store } = boundStore();
      const opened = eventOf({ type: "own.connection.opened", note: "first" });
      const renamed = eventOf({ type: "own.connection.renamed", note: "second" });

      await store.append({ tenantId: TENANT, events: [opened, renamed] });

      const read = await readAll(store);
      expect(read.map((event) => event.id)).toEqual([opened.id, renamed.id]);
    });

    /** @scenario "A read answers only the events the reader accepts" */
    it("keeps only the events the reader accepts", async () => {
      const { store } = boundStore();
      const opened = eventOf({ type: "own.connection.opened", note: "first" });
      await store.append({
        tenantId: TENANT,
        events: [opened, eventOf({ type: "own.connection.renamed", note: "second" })],
      });

      const read = await store.read({
        tenantId: TENANT,
        aggregateId: AGGREGATE_ID,
        accepts: isOpenedEvent,
      });

      expect(read.map((event) => event.id)).toEqual([opened.id]);
    });

    /** @scenario "A read never answers another aggregate type's stream" */
    it("answers none of another aggregate type's events under the same id", async () => {
      const log = EventStoreMemory.createForTesting();
      const foreign = eventOf({
        type: "own.connection.opened",
        aggregateType: "other_aggregate",
        note: "not ours",
      });
      await log.storeEvents([foreign], { tenantId: createTenantId(TENANT) }, "other_aggregate");
      const { store } = boundStore(log);

      expect(await readAll(store)).toEqual([]);
    });

    /** @scenario "An append of another aggregate type's event is refused" */
    it("refuses an event of another aggregate type and writes nothing", async () => {
      const { store, log } = boundStore();
      const foreign = eventOf({
        type: "own.connection.opened",
        aggregateType: "other_aggregate",
        note: "not ours",
      });

      await expect(
        store.append({
          tenantId: TENANT,
          events: [eventOf({ type: "own.connection.opened", note: "ours" }), foreign],
        }),
      ).rejects.toMatchObject({
        name: "ConfigurationError",
        context: {
          pipeline: "own_connections",
          operation: "append",
          aggregateType: "other_aggregate",
        },
      });
      const written = await log.getEvents({
        aggregateId: AGGREGATE_ID,
        context: { tenantId: createTenantId(TENANT) },
        aggregateType: "own_connection",
      });
      expect(written).toEqual([]);
    });
  });

  describe("given a store whose definition has not been built", () => {
    /** @scenario "A store used before its pipeline is built refuses by name" */
    it("refuses an append and a read, each naming the pipeline and itself", async () => {
      const store = PipelineEventStore.create({
        pipeline: "own_connections",
        log: () => EventStoreMemory.createForTesting(),
      });

      await expect(
        store.append({
          tenantId: TENANT,
          events: [eventOf({ type: "own.connection.opened", note: "x" })],
        }),
      ).rejects.toMatchObject({
        name: "ConfigurationError",
        context: { pipeline: "own_connections", operation: "append" },
      });
      await expect(readAll(store)).rejects.toMatchObject({
        name: "ConfigurationError",
        context: { pipeline: "own_connections", operation: "read" },
      });
    });
  });

  describe("given a process whose eventing opened no event log", () => {
    /** @scenario "A store in a process holding no event log refuses by name" */
    it("refuses an append and a read, each naming the pipeline and itself", async () => {
      const store = PipelineEventStore.create({ pipeline: "own_connections", log: () => void 0 });
      store.bindTo(connectionPipeline());

      await expect(
        store.append({
          tenantId: TENANT,
          events: [eventOf({ type: "own.connection.opened", note: "x" })],
        }),
      ).rejects.toMatchObject({
        name: "ConfigurationError",
        context: { pipeline: "own_connections", operation: "append" },
      });
      await expect(readAll(store)).rejects.toMatchObject({
        name: "ConfigurationError",
        context: { pipeline: "own_connections", operation: "read" },
      });
    });
  });

  describe("given a producer-only process's event log", () => {
    /** @scenario "A producer-only process keeps the producer's refusal" */
    it("refuses an append and a read with the producer's own refusal", async () => {
      const { store } = boundStore(EventStoreProducerOnly.create({ processName: "langwatch-api" }));

      await expect(
        store.append({
          tenantId: TENANT,
          events: [eventOf({ type: "own.connection.opened", note: "x" })],
        }),
      ).rejects.toMatchObject({
        name: "ConfigurationError",
        context: { processName: "langwatch-api", operation: "storeEvents" },
      });
      await expect(readAll(store)).rejects.toMatchObject({
        name: "ConfigurationError",
        context: { processName: "langwatch-api", operation: "getEvents" },
      });
    });
  });

  describe("given a runtime with an event store and the pipeline registered on it", () => {
    /** @scenario "An append lands in the event log its runtime folds from" */
    it("appends into the runtime's own event store under the pipeline's aggregate type", async () => {
      const runtimeStore = EventStoreMemory.createForTesting();
      const runtime = EventSourcing.createForTesting({ eventStore: runtimeStore });
      const definition = connectionPipeline();
      runtime.register(definition);
      const store = PipelineEventStore.create({
        pipeline: definition.metadata.name,
        log: () => runtime.eventStore,
      });
      store.bindTo(definition);
      const opened = eventOf({ type: "own.connection.opened", note: "first" });

      await store.append({ tenantId: TENANT, events: [opened] });

      const held = await runtimeStore.getEvents({
        aggregateId: AGGREGATE_ID,
        context: { tenantId: createTenantId(TENANT) },
        aggregateType: "own_connection",
      });
      expect(held.map((event) => event.id)).toEqual([opened.id]);
    });
  });
});
