/**
 * @vitest-environment node
 * Spec: specs/eventing/role-participation.feature
 * Two processes, one declaration, one queue: the api's send reaches the
 * worker's process manager, and the api builds no reaction at all.
 */
import { createApp, defineServerModule, type FeatureSetup } from "@langwatch/kernel";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Command, CommandHandler } from "../../commands/command.ts";
import { defineCommandSchema } from "../../commands/commandSchema.ts";
import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { defineEventingModule, type EventingSetup } from "../../pipeline/eventingModule.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import { InMemoryProcessStore } from "../../process-manager/stores/inMemoryProcessStore.ts";
import type { ProcessStore } from "../../process-manager/stores/processStore.types.ts";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../../queues/index.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";
import { EventUtils } from "../../utils/event.utils.ts";

const TENANT_ID = "organization-1";
const AGGREGATE_ID = "trace-1";
const PROCESS_NAME = "trace-follow-up";
const EVENT_SCHEMA_VERSION = "2026-09-02";

const recordedEventSchema = testEventSchema("producer.recorded", z.object({ note: z.string() }));
type RecordedEvent = z.infer<typeof recordedEventSchema>;

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

/** The module's app, as small as `withApp` accepts one. */
abstract class TraceApp {
  abstract sendRecord(note: string): Promise<void>;
}

class ComposedTraceApp extends TraceApp {
  static readonly contract = TraceApp;
  static readonly dependencies = {};
  /** The member this process's role decides the half of. */
  static readonly reads = ["eventing"] as const;

  /** A send on the sender this process's own registration answered with. */
  record: ((note: string) => Promise<void>) | undefined;

  static create(
    _setup: FeatureSetup<
      typeof ComposedTraceApp.dependencies,
      Readonly<{ eventing: EventSourcing }>,
      undefined
    >,
  ): ComposedTraceApp {
    return new ComposedTraceApp();
  }

  async sendRecord(note: string): Promise<void> {
    if (!this.record) throw new Error("This process registered no record command.");
    await this.record(note);
  }
}

/** What each process was handed when it installed the declaration. */
interface InstalledAs {
  readonly participation: string;
  readonly processStore: ProcessStore | undefined;
}

/**
 * The module declares the pipeline once. Both processes install this same
 * object, so any difference between them is the role's, not the module's.
 */
function traceEventing(seen: InstalledAs[]) {
  return defineEventingModule({
    pipeline: "trace_processing",
    build: (setup: EventingSetup<undefined, TraceApp>) => {
      seen.push({ participation: setup.participation, processStore: setup.processStore });
      return definePipeline({
        name: "trace_processing",
        aggregate: defineAggregate({
          type: "trace",
        }),
      })
        .withEvents([recordedEventSchema])
        .withProcessManager(PROCESS_NAME, (process) =>
          process
            .state({ handled: 0 })
            .keyBy(() => AGGREGATE_ID)
            .on("producer.recorded", (state) => ({ state: { handled: state.handled + 1 } })),
        )
        .withCommand("record", RecordCommand)
        .build();
    },
    connect: ({ app, commands }) => {
      (app as ComposedTraceApp).record = (note) =>
        commands.record.send({ tenantId: TENANT_ID, aggregateId: AGGREGATE_ID, note });
    },
  });
}

/**
 * The one `event-sourcing/jobs` queue, as two processes see it: whoever
 * consumes registers the drain, everyone's send lands in the same backlog.
 */
function sharedQueue() {
  const pending: Record<string, unknown>[] = [];
  let drain: EventSourcedQueueDefinition<Record<string, unknown>>["process"] | undefined;

  const factoryFor =
    (consumersEnabled: boolean) =>
    (
      definition: EventSourcedQueueDefinition<Record<string, unknown>>,
    ): EventSourcedQueueProcessor<Record<string, unknown>> => {
      if (consumersEnabled) drain = definition.process;
      return {
        send: async (payload) => void pending.push(payload),
        sendBatch: async (payloads) => void pending.push(...payloads),
        close: async () => {},
        waitUntilReady: async () => {},
      };
    };

  return {
    factoryFor,
    /** Drains until the backlog is empty, jobs a handler queued included. */
    settle: async () => {
      if (!drain) throw new Error("No process claimed the queue.");
      for (let job = pending.shift(); job !== void 0; job = pending.shift()) {
        await drain(job);
      }
    },
  };
}

describe("given one module declaration installed by an api process and a worker", () => {
  describe("when the api sends the command and the worker drains the queue", () => {
    /** @scenario "A command sent by the producing process is handled by the consuming one" */
    it("lands the event in the worker's own process manager state", async () => {
      const queue = sharedQueue();
      const eventStore = EventStoreMemory.createForTesting();
      const processStore = InMemoryProcessStore.createForTesting();
      const installedAs: InstalledAs[] = [];
      const module = defineServerModule("trace")
        .withApp(ComposedTraceApp)
        .withEventing(traceEventing(installedAs));

      const worker = new EventSourcing({
        eventStore,
        processStore,
        executionTarget: "worker",
        consumersEnabled: true,
        queueFactory: queue.factoryFor(true),
      });
      const api = new EventSourcing({
        eventStore,
        executionTarget: "api",
        consumersEnabled: false,
        processManagerMode: "producer-only",
        queueFactory: queue.factoryFor(false),
      });
      const workerRuntime = await createApp({ role: "worker" })
        .withEventing(worker)
        .withModules([module])
        .boot();
      const apiRuntime = await createApp({ role: "api" })
        .withEventing(api)
        .withModules([module])
        .boot();

      await apiRuntime.service(TraceApp).sendRecord("sent by the api");
      await queue.settle();

      const instance = await processStore.findByRef({
        ref: { processName: PROCESS_NAME, projectId: TENANT_ID, processKey: AGGREGATE_ID },
      });
      expect(instance?.state).toEqual({ handled: 1 });
      // One append, by the process that drained the job. Two would mean the
      // api executed the command as well as staging it.
      const stored = await eventStore.getEvents(
        AGGREGATE_ID,
        { tenantId: createTenantId(TENANT_ID) },
        "trace",
      );
      expect(stored.map((event) => event.type)).toEqual(["producer.recorded"]);
      expect(installedAs.map((installed) => installed.participation)).toEqual([
        "consume",
        "produce",
      ]);
      await workerRuntime.stop();
      await apiRuntime.stop();
    });

    /** @scenario "The producing process constructs no reaction" */
    it("builds the api's half with no process runtime and no process store", async () => {
      const queue = sharedQueue();
      const installedAs: InstalledAs[] = [];
      const module = defineServerModule("trace")
        .withApp(ComposedTraceApp)
        .withEventing(traceEventing(installedAs));
      const api = new EventSourcing({
        eventStore: EventStoreMemory.createForTesting(),
        executionTarget: "api",
        consumersEnabled: false,
        processManagerMode: "producer-only",
        queueFactory: queue.factoryFor(false),
      });

      const apiRuntime = await createApp({ role: "api" })
        .withEventing(api)
        .withModules([module])
        .boot();

      expect(installedAs.map((installed) => installed.processStore)).toEqual([void 0]);
      expect(api.unrunProcessManagers).toEqual([PROCESS_NAME]);
      expect(() => api.processRuntime).toThrow(/producer-only/);
      await apiRuntime.stop();
    });
  });
});

describe("given a process whose shape is not its role's", () => {
  describe("when its eventing member states the half it runs", () => {
    /** @scenario "A process that states its own participation overrides the role" */
    it("installs the declaration as a consumer inside an api-role process", async () => {
      const queue = sharedQueue();
      const installedAs: InstalledAs[] = [];
      const module = defineServerModule("trace")
        .withApp(ComposedTraceApp)
        .withEventing(traceEventing(installedAs));
      const stated = new EventSourcing({
        eventStore: EventStoreMemory.createForTesting(),
        processStore: InMemoryProcessStore.createForTesting(),
        executionTarget: "api",
        consumersEnabled: true,
        participation: "consume",
        queueFactory: queue.factoryFor(true),
      });

      const runtime = await createApp({ role: "api" })
        .withEventing(stated)
        .withModules([module])
        .boot();

      expect(installedAs.map((installed) => installed.participation)).toEqual(["consume"]);
      await runtime.stop();
    });
  });
});
