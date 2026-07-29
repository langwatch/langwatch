import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { Command, CommandHandler } from "../../commands/command";
import { defineCommandSchema } from "../../commands/commandSchema";
import type { Event } from "../../domain/types";
import { EventSourcing } from "../../eventSourcing";
import { definePipeline } from "../../pipeline/staticBuilder";
import { createMockEventStore } from "../../services/__tests__/testHelpers";

const payloadSchema = z.object({ tenantId: z.string(), id: z.string() });
type Payload = z.infer<typeof payloadSchema>;

class ConsumeThingCommand implements CommandHandler<Command<Payload>, Event> {
  static readonly schema = defineCommandSchema(
    "lw.test.command_bus.consume" as never,
    payloadSchema,
  );

  static getAggregateId(payload: Payload): string {
    return payload.id;
  }

  async handle(): Promise<Event[]> {
    return [];
  }
}

/** A second class with an identical schema shape — identity must separate them. */
class OtherThingCommand implements CommandHandler<Command<Payload>, Event> {
  static readonly schema = defineCommandSchema(
    "lw.test.command_bus.other" as never,
    payloadSchema,
  );

  static getAggregateId(payload: Payload): string {
    return payload.id;
  }

  async handle(): Promise<Event[]> {
    return [];
  }
}

const consumerPipeline = () =>
  definePipeline<Event>()
    .withName("command-bus-consumer")
    .withAggregateType("trace")
    .withCommand("consumeThing", ConsumeThingCommand)
    .build();

const otherPipeline = () =>
  definePipeline<Event>()
    .withName("command-bus-other")
    .withAggregateType("trace")
    .withCommand("otherThing", OtherThingCommand)
    .build();

function mockGlobalQueue() {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

describe("EventSourcing command bus", () => {
  beforeEach(() => {
    vi.stubEnv("BUILD_TIME", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("when a port is bound before the owning pipeline registers", () => {
    /** @scenario A port bound before its pipeline registers still dispatches */
    it("dispatches through the real pipeline once it has registered", async () => {
      const queue = mockGlobalQueue();
      const es = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
        globalQueue: queue,
      });

      const consume = es.commandBus.port(ConsumeThingCommand);
      es.register(consumerPipeline());

      await consume({ tenantId: "project-1", id: "thing-1" });

      expect(queue.send).toHaveBeenCalledTimes(1);
      expect(queue.send.mock.calls[0]?.[0]).toMatchObject({
        __pipelineName: "command-bus-consumer",
        __jobName: "consumeThing",
        id: "thing-1",
      });
    });
  });

  describe("when two pipelines register commands", () => {
    /** @scenario Each command class resolves to the pipeline that registered it */
    it("routes each command class to its own pipeline", async () => {
      const queue = mockGlobalQueue();
      const es = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
        globalQueue: queue,
      });
      es.register(consumerPipeline());
      es.register(otherPipeline());

      await es.commandBus.send(OtherThingCommand, {
        tenantId: "project-1",
        id: "thing-2",
      });

      expect(queue.send.mock.calls[0]?.[0]).toMatchObject({
        __pipelineName: "command-bus-other",
        __jobName: "otherThing",
      });
    });
  });

  describe("when the command belongs to no registered pipeline", () => {
    /** @scenario Sending a command no pipeline registered names the command */
    it("names the command and what is registered", async () => {
      const es = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
        globalQueue: mockGlobalQueue(),
      });
      es.register(otherPipeline());

      await expect(
        es.commandBus.send(ConsumeThingCommand, {
          tenantId: "project-1",
          id: "thing-3",
        }),
      ).rejects.toThrow(/lw\.test\.command_bus\.consume/);

      expect(() => es.commandBus.assertPortsResolvable()).not.toThrow();
    });
  });

  describe("when event sourcing is disabled", () => {
    /** @scenario A disabled runtime drops a bus-dispatched command */
    it("drops the command instead of failing to resolve it", async () => {
      const es = new EventSourcing({ enabled: false });
      es.register(consumerPipeline());

      await expect(
        es.commandBus.send(ConsumeThingCommand, {
          tenantId: "project-1",
          id: "thing-4",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
