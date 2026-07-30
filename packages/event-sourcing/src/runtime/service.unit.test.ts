import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfigurationError } from "../errors";
import { definePipeline } from "../pipeline/definePipeline";
import type {
  CommittedEvent,
  EnginePorts,
  EventProducer,
  Lane,
  LaneConsumer,
} from "./contracts";
import { createRegistry } from "./registry";
import { createEventSourcingService } from "./service";

/**
 * The service owns lifecycle only: register, start, stop, replay (ADR-108
 * decision 1). Registration is unconditional; only consumption is gated on
 * `runsConsumers` (ADR-110 decision 6), and `stop()` is idempotent.
 */

const spanReceived = z.object({ traceId: z.string(), spanId: z.string() });

function tracePipeline() {
  return definePipeline("trace")
    .events({ spanReceived })
    .id({ spanReceived: (d) => d.traceId })
    .withCommand("recordSpan", {
      input: spanReceived,
      handle: async (input) => [{ type: "spanReceived", data: input }],
    })
    .build();
}

function fakePorts(overrides: Partial<EnginePorts> = {}): EnginePorts {
  return {
    eventLog: { append: async () => undefined, scan: async function* () {} },
    queue: {
      stage: async () => undefined,
      claim: async () => null,
      settle: async () => undefined,
      retry: async () => undefined,
      park: async () => undefined,
      depth: async () => 0,
    },
    spool: {
      put: async () => "",
      get: async () => null,
      release: async () => undefined,
    },
    processStore: {
      load: async () => null,
      save: async () => undefined,
      due: async () => [],
    },
    outbox: {
      stage: async () => undefined,
      claim: async () => [],
      settle: async () => undefined,
      fail: async () => undefined,
      prune: async () => 0,
    },
    clock: { now: () => 1_000 },
    ...overrides,
  };
}

function fakeConsumer(): LaneConsumer & {
  calls: { start: number; stop: number };
} {
  const calls = { start: 0, stop: 0 };
  return {
    calls,
    start() {
      calls.start += 1;
    },
    async stop() {
      calls.stop += 1;
    },
  };
}

function fakeProducer(): EventProducer & {
  published: readonly CommittedEvent[][];
} {
  const published: CommittedEvent[][] = [];
  return {
    published,
    async publish(events) {
      published.push([...events]);
    },
  };
}

describe("createEventSourcingService", () => {
  describe("given consumption is gated but registration and dispatch are not", () => {
    /** @scenario starting with consumption disabled starts no consumer, and the command surface still dispatches */
    it("starts no consumer, and still dispatches a command, when consumption is disabled", async () => {
      const consumer = fakeConsumer();
      const service = createEventSourcingService({
        ports: fakePorts(),
        consumer,
      });
      service.register(tracePipeline());

      await service.start({ runsConsumers: false });
      expect(consumer.calls.start).toBe(0);

      const result = await service.commands.send(
        "recordSpan",
        { traceId: "t1", spanId: "s1" },
        { tenantId: "tenant-1" },
      );
      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.eventType).toBe("trace/spanReceived");
    });

    /** @scenario starting with consumption enabled starts the injected consumer */
    it("starts the injected consumer when consumption is enabled", async () => {
      const consumer = fakeConsumer();
      const service = createEventSourcingService({
        ports: fakePorts(),
        consumer,
      });
      service.register(tracePipeline());

      await service.start({ runsConsumers: true });
      expect(consumer.calls.start).toBe(1);
    });

    /** @scenario stopping a service twice is a no-op */
    it("does not stop the consumer a second time once already stopped", async () => {
      const consumer = fakeConsumer();
      const service = createEventSourcingService({
        ports: fakePorts(),
        consumer,
      });
      service.register(tracePipeline());

      await service.start({ runsConsumers: true });
      await service.stop();
      expect(consumer.calls.stop).toBe(1);

      await service.stop();
      expect(consumer.calls.stop).toBe(1);
    });
  });

  describe("given a command name no registered pipeline owns", () => {
    it("refuses to dispatch, naming the command and what is registered", async () => {
      const service = createEventSourcingService({ ports: fakePorts() });
      service.register(tracePipeline());

      let caught: unknown;
      try {
        await service.commands.send("nothing", {}, { tenantId: "tenant-1" });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigurationError);
      expect((caught as ConfigurationError).context).toMatchObject({
        command: "nothing",
        registered: ["recordSpan"],
      });
    });
  });

  describe("given start() checks the registry before touching anything else", () => {
    it("fails start() when an injected registry has a command port that resolves to nothing", async () => {
      const registry = createRegistry();
      registry.bindCommandPort("billing/chargeCard");
      const consumer = fakeConsumer();
      const service = createEventSourcingService({
        ports: fakePorts(),
        registry,
        consumer,
      });

      await expect(service.start({ runsConsumers: true })).rejects.toThrow(
        ConfigurationError,
      );
      expect(consumer.calls.start).toBe(0);
    });
  });

  describe("given a producer is supplied", () => {
    it("publishes committed events through the producer instead of appending to the event log directly", async () => {
      const producer = fakeProducer();
      const appended: CommittedEvent[][] = [];
      const ports = fakePorts({
        eventLog: {
          append: async (events) => void appended.push([...events]),
          scan: async function* () {},
        },
      });
      const service = createEventSourcingService({ ports, producer });
      service.register(tracePipeline());

      await service.commands.send(
        "recordSpan",
        { traceId: "t1", spanId: "s1" },
        { tenantId: "tenant-1" },
      );

      expect(producer.published).toHaveLength(1);
      expect(appended).toHaveLength(0);
    });
  });

  describe("given replay is an injected collaborator", () => {
    it("delegates to the injected replay function", async () => {
      const report = { events: 3, applied: 3, skippedByVersion: 0 };
      const service = createEventSourcingService({
        ports: fakePorts(),
        replay: async () => report,
      });

      await expect(
        service.replay({ tenantId: "tenant-1", aggregateType: "trace" }),
      ).resolves.toBe(report);
    });

    it("refuses to replay when nothing was wired in", async () => {
      const service = createEventSourcingService({ ports: fakePorts() });
      await expect(
        service.replay({ tenantId: "tenant-1", aggregateType: "trace" }),
      ).rejects.toThrow(ConfigurationError);
    });
  });

  describe("given enabled(lane) is the one predicate a consumer consults", () => {
    const lane: Lane = { kind: "fold", name: "summary" };

    it("defaults true when the ports supply no predicate", () => {
      const service = createEventSourcingService({ ports: fakePorts() });
      expect(service.enabled(lane)).toBe(true);
    });

    it("consults the ports' predicate when one is supplied", () => {
      const service = createEventSourcingService({
        ports: fakePorts({
          enabled: (candidate) => candidate.name !== "summary",
        }),
      });
      expect(service.enabled(lane)).toBe(false);
      expect(service.enabled({ kind: "fold", name: "other" })).toBe(true);
    });
  });
});
