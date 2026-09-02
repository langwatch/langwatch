/**
 * @vitest-environment node
 *
 * Spec: packages/eventing/specs/producer-only-event-store.feature
 *
 * A pipeline that declares a process manager used to be unregisterable in a
 * process holding no `ProcessStore`, which made every command on it unsendable
 * from the tier that a customer's action actually arrives at. This pins the
 * mode that separates the two: the producer registers the pipeline whole and
 * declines the process manager BY NAME.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Command, CommandHandler } from "../../commands/command";
import { defineCommandSchema } from "../../commands/commandSchema";
import { defineAggregate, defineEvents } from "../../domain/definitions";
import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { EventSourcing } from "../../eventSourcing";
import { definePipeline } from "../../pipeline/staticBuilder";
import { InMemoryProcessStore } from "../../process-manager/stores/inMemoryProcessStore";
import { EventStoreMemory } from "../../stores/eventStoreMemory";
import { EventUtils } from "../../utils/event.utils";

const TENANT_ID = "organization-1";
const AGGREGATE_ID = "aggregate-1";
const PROCESS_NAME = "run-execution";
/** The event schema version, in the ISO-date form the event contract requires. */
const EVENT_SCHEMA_VERSION = "2026-09-02";

type RecordedEvent = Event<{ note: string }> & { type: "producer.recorded" };

const recordPayloadSchema = z.object({
  tenantId: z.string(),
  aggregateId: z.string(),
  note: z.string(),
});

class RecordCommand implements CommandHandler<
  Command<z.infer<typeof recordPayloadSchema>>,
  RecordedEvent
> {
  static readonly schema = defineCommandSchema("record", recordPayloadSchema, "Record one note");

  static getAggregateId(payload: { aggregateId: string }): string {
    return payload.aggregateId;
  }

  handle(command: Command<{ aggregateId: string; note: string }>): RecordedEvent[] {
    return [
      EventUtils.createEvent<RecordedEvent>({
        aggregateType: "trace",
        aggregateId: command.data.aggregateId,
        tenantId: createTenantId(command.tenantId),
        type: "producer.recorded",
        version: EVENT_SCHEMA_VERSION,
        data: { note: command.data.note },
        metadata: {},
      }),
    ];
  }
}

/**
 * The shape both tiers register: one command, and a process manager mounted on
 * the very event that command appends. Registering it is what a producer could
 * not do at all before this mode existed.
 */
function pipelineWithProcessManager() {
  return definePipeline<RecordedEvent>({
    name: "producer-process-pipeline",
    aggregate: defineAggregate({
      type: "trace",
      events: defineEvents(["producer.recorded"] as const),
    }),
  })
    .withProcessManager(PROCESS_NAME, (process) =>
      process
        .state({ handled: 0 })
        .keyBy(() => "process-key-1")
        .on("producer.recorded", (state) => ({ state: { handled: state.handled + 1 } })),
    )
    .withCommand("record", RecordCommand)
    .build();
}

function producerRuntime() {
  return new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    executionTarget: "api",
    processManagerMode: "producer-only",
  });
}

describe("given a runtime that registers pipelines producer-only", () => {
  describe("when a pipeline that declares a process manager is registered", () => {
    /** @scenario "A pipeline declaring a process manager still registers" */
    it("registers it without a ProcessStore instead of refusing the whole pipeline", () => {
      const eventSourcing = producerRuntime();

      const pipeline = eventSourcing.register(pipelineWithProcessManager());

      expect(pipeline.name).toBe("producer-process-pipeline");
      // The registration this replaces returned a `DisabledPipeline`, whose
      // commands resolve without reaching anything at all — indistinguishable
      // from a send at the call site, and a total loss of the write.
      expect(pipeline.constructor.name).not.toBe("DisabledPipeline");
      expect(eventSourcing.definitions).toHaveLength(1);
    });

    /** @scenario "A pipeline declaring a process manager still registers" */
    it("names the process manager it will not run rather than the count of them", () => {
      const eventSourcing = producerRuntime();

      eventSourcing.register(pipelineWithProcessManager());

      expect(eventSourcing.unrunProcessManagers).toEqual([PROCESS_NAME]);
    });

    /** @scenario "The process manager is refused rather than half-run" */
    it("refuses the process runtime by name rather than mounting an inbox nothing drains", () => {
      const eventSourcing = producerRuntime();
      eventSourcing.register(pipelineWithProcessManager());

      expect(() => eventSourcing.processRuntime).toThrow(/producer-only/);
    });
  });

  describe("when one of that pipeline's commands is dispatched", () => {
    /** @scenario "A command on a process-manager pipeline appends and returns" */
    it("appends the command's events and returns rather than refusing", async () => {
      const eventStore = EventStoreMemory.createForTesting();
      const eventSourcing = new EventSourcing({
        eventStore,
        executionTarget: "api",
        processManagerMode: "producer-only",
      });
      const pipeline = eventSourcing.register(pipelineWithProcessManager());

      await pipeline.commands.record.send({
        tenantId: TENANT_ID,
        aggregateId: AGGREGATE_ID,
        note: "produced here",
      });

      const stored = await eventStore.getEvents(
        AGGREGATE_ID,
        { tenantId: createTenantId(TENANT_ID) },
        "trace",
      );
      expect(stored.map((event) => event.type)).toEqual(["producer.recorded"]);
      await eventSourcing.close();
    });

    /**
     * The discriminator for "declined" against "silently inert": the process
     * store a run-mode runtime writes its instance into stays empty here,
     * because no subscriber was generated to deliver into it.
     */
    /** @scenario "The process manager is refused rather than half-run" */
    it("leaves the process manager unfed, so no half-run instance is persisted", async () => {
      const processStore = InMemoryProcessStore.createForTesting();
      const eventSourcing = new EventSourcing({
        eventStore: EventStoreMemory.createForTesting(),
        executionTarget: "api",
        processManagerMode: "producer-only",
        // Supplied deliberately: even handed a store, a producer must not run
        // the manager, or two tiers would drive one process's state.
        processStore,
      });
      const pipeline = eventSourcing.register(pipelineWithProcessManager());

      await pipeline.commands.record.send({
        tenantId: TENANT_ID,
        aggregateId: AGGREGATE_ID,
        note: "produced here",
      });

      await expect(
        processStore.findByRef({
          ref: {
            processName: PROCESS_NAME,
            projectId: TENANT_ID,
            processKey: "process-key-1",
          },
        }),
      ).resolves.toBeNull();
      await eventSourcing.close();
    });
  });
});

describe("given a runtime that runs the process managers it registers", () => {
  /** @scenario "The consumer's requirement is unchanged" */
  it("still refuses a process-manager pipeline with no durable ProcessStore", () => {
    const eventSourcing = new EventSourcing({
      eventStore: EventStoreMemory.createForTesting(),
    });

    expect(() => eventSourcing.register(pipelineWithProcessManager())).toThrow(
      "A durable ProcessStore is required for process managers",
    );
    expect(eventSourcing.unrunProcessManagers).toEqual([]);
  });
});
