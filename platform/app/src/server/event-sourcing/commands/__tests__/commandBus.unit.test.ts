import { describe, expect, it } from "vitest";
import { ContributeLogFactsCommand } from "../../pipelines/coding-agent-processing/commands/contributeLogFactsCommand";
import { ContributeMetricFactsCommand } from "../../pipelines/coding-agent-processing/commands/contributeMetricFactsCommand";
import type { EventSourcedQueueProcessor } from "../../queues";
import { type AnyCommandClass, createCommandBus } from "../commandBus";

interface Dispatched {
  sent: unknown[];
  batched: unknown[][];
}

function recordingDispatcher(): EventSourcedQueueProcessor<any> & Dispatched {
  const sent: unknown[] = [];
  const batched: unknown[][] = [];
  return {
    sent,
    batched,
    async send(payload: unknown) {
      sent.push(payload);
    },
    async sendBatch(payloads: unknown[]) {
      batched.push(payloads);
    },
    async close() {},
    async waitUntilReady() {},
  };
}

/** A registry the test can populate after ports have already been bound. */
function mutableRegistry() {
  const index = new Map<AnyCommandClass, EventSourcedQueueProcessor<any>>();
  return {
    index,
    bus: createCommandBus({
      resolve: (command) => index.get(command),
      registered: () => Array.from(index.keys(), (c) => c.schema.type),
    }),
  };
}

describe("createCommandBus", () => {
  describe("when a command class is registered", () => {
    it("resolves the dispatcher by object identity, not by name", async () => {
      const { index, bus } = mutableRegistry();
      const metric = recordingDispatcher();
      const log = recordingDispatcher();
      index.set(ContributeMetricFactsCommand, metric);
      index.set(ContributeLogFactsCommand, log);

      await bus.send(ContributeMetricFactsCommand, {
        sessionId: "session-1",
      } as never);

      expect(metric.sent).toHaveLength(1);
      expect(log.sent).toHaveLength(0);
    });

    it("forwards send options through to the queue dispatcher", async () => {
      const { index, bus } = mutableRegistry();
      const metric = recordingDispatcher();
      let observedOptions: unknown;
      metric.send = async (_payload: unknown, options?: unknown) => {
        observedOptions = options;
      };
      index.set(ContributeMetricFactsCommand, metric);

      await bus.send(ContributeMetricFactsCommand, {} as never, {
        delay: 250,
      });

      expect(observedOptions).toEqual({ delay: 250 });
    });

    it("sends a batch through sendBatch", async () => {
      const { index, bus } = mutableRegistry();
      const metric = recordingDispatcher();
      index.set(ContributeMetricFactsCommand, metric);

      await bus.sendBatch(ContributeMetricFactsCommand, [
        { sessionId: "a" },
        { sessionId: "b" },
      ] as never);

      expect(metric.batched).toEqual([[{ sessionId: "a" }, { sessionId: "b" }]]);
    });
  });

  describe("when a port is bound before the owning pipeline registers", () => {
    it("resolves at dispatch time, so registration order carries no meaning", async () => {
      const { index, bus } = mutableRegistry();

      // Bind first — this is the pipeline-construction moment.
      const contributeMetricFacts = bus.port(ContributeMetricFactsCommand);

      // Register second — this is the other pipeline registering later.
      const metric = recordingDispatcher();
      index.set(ContributeMetricFactsCommand, metric);

      await contributeMetricFacts({ sessionId: "late" } as never);

      expect(metric.sent).toEqual([{ sessionId: "late" }]);
    });

    it("does not throw at bind time for a command that is never registered", () => {
      const { bus } = mutableRegistry();
      expect(() => bus.port(ContributeMetricFactsCommand)).not.toThrow();
    });
  });

  describe("when a command resolves to no registered pipeline", () => {
    it("names the command and lists what is registered", async () => {
      const { index, bus } = mutableRegistry();
      index.set(ContributeLogFactsCommand, recordingDispatcher());

      await expect(
        bus.send(ContributeMetricFactsCommand, {} as never),
      ).rejects.toThrow(ContributeMetricFactsCommand.schema.type);
      await expect(
        bus.send(ContributeMetricFactsCommand, {} as never),
      ).rejects.toThrow(/is not registered on any pipeline/);
    });
  });

  describe("when the boot assertion runs after registration", () => {
    it("passes once every bound port resolves", () => {
      const { index, bus } = mutableRegistry();
      bus.port(ContributeMetricFactsCommand);
      index.set(ContributeMetricFactsCommand, recordingDispatcher());

      expect(() => bus.assertPortsResolvable()).not.toThrow();
    });

    /** @scenario Registration completing with an unresolvable port fails at boot */
    it("fails at boot naming every port that resolves to nothing", () => {
      const { index, bus } = mutableRegistry();
      bus.port(ContributeMetricFactsCommand);
      bus.port(ContributeLogFactsCommand);
      index.set(ContributeLogFactsCommand, recordingDispatcher());

      expect(() => bus.assertPortsResolvable()).toThrow(
        ContributeMetricFactsCommand.schema.type,
      );
    });

    it("passes when nothing bound a port at all", () => {
      const { bus } = mutableRegistry();
      expect(() => bus.assertPortsResolvable()).not.toThrow();
    });
  });
});
