import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ContributeLogFactsCommand } from "../../pipelines/coding-agent-processing/commands/contributeLogFactsCommand";
import { ContributeMetricFactsCommand } from "../../pipelines/coding-agent-processing/commands/contributeMetricFactsCommand";
import type { ContributeMetricFactsCommandData } from "../../pipelines/coding-agent-processing/schemas/commands";
import type { EventSourcedQueueProcessor } from "../../queues";
import type { Command, CommandHandler } from "../command";
import { type AnyCommandClass, createCommandBus } from "../commandBus";
import { defineCommandSchema } from "../commandSchema";
import type { DefinedCommandClass } from "../defineCommand";

/**
 * The compile-time guard for ADR-082 §5.
 *
 * `ExtractCommandHandlerPayload<C>` is a deferred conditional, so `C` is
 * inferred solely from argument 1. That is the desired behaviour — the
 * imported symbol drives the payload type and a typo becomes an
 * excess-property error — but it means the checking silently disappears if the
 * bus signature is ever widened. Every `@ts-expect-error` below is load
 * bearing: if the payload collapses to `any`, the directive becomes unused and
 * `pnpm typecheck:tests` fails.
 *
 * The file also runs under vitest, so the runtime behaviour behind each
 * suppressed line is asserted rather than assumed.
 */

let sent: unknown[] = [];
const dispatcher: EventSourcedQueueProcessor<any> = {
  async send(payload: unknown) {
    sent.push(payload);
  },
  async sendBatch(payloads: unknown[]) {
    sent.push(...payloads);
  },
  async close() {},
  async waitUntilReady() {},
};

const index = new Map<AnyCommandClass, EventSourcedQueueProcessor<any>>([
  [ContributeMetricFactsCommand, dispatcher],
  [ContributeLogFactsCommand, dispatcher],
]);

const bus = createCommandBus({
  resolve: (command) => index.get(command),
  registered: () => Array.from(index.keys(), (command) => command.schema.type),
});

const validPayload: ContributeMetricFactsCommandData = {
  tenantId: "project-1",
  sessionId: "session-1",
  sessionKeySource: "provider",
  agent: "claude_code",
  occurredAt: 1,
  seriesId: "series-1",
  metricName: "claude_code.lines_of_code.count",
  unit: null,
  attributes: {},
  value: 1,
  dataPointCount: 1,
  asOfUnixMs: 1,
};

/**
 * A command with constructor DI, exactly like `ExecuteEvaluationCommand`,
 * `ComputeRunMetricsCommand` and `ReportUsageForMonthCommand` — the three
 * registered through `.withCommandInstance`. It satisfies
 * `CommandHandlerClassStatic` and NOT `CommandHandlerClass`, which is why the
 * bus is constrained on the former.
 */
class DiConstructedCommand implements CommandHandler<Command<{ id: string }>> {
  static readonly schema = defineCommandSchema(
    "lw.test.di_constructed" as never,
    z.object({ id: z.string() }),
  );

  static getAggregateId(payload: { id: string }): string {
    return payload.id;
  }

  constructor(private readonly deps: { run: () => void }) {}

  async handle(): Promise<never[]> {
    this.deps.run();
    return [];
  }
}

/** Stands in for a bus constrained on `DefinedCommandClass` instead. */
function acceptsOnlyDefinedCommandClasses<
  C extends DefinedCommandClass<any, any>,
>(_command: C): void {}

describe("the command bus type surface", () => {
  // Each test asserts its OWN sends. Vitest runs files sequentially by
  // default, but that is a default and not a contract — `sequence.shuffle`
  // exists to catch suites that quietly depend on declaration order.
  beforeEach(() => {
    sent = [];
  });

  describe("when the payload is inferred from the imported command class", () => {
    /** @scenario A payload that does not match the command class is a compile error */
    it("rejects an unknown member on the payload", async () => {
      await bus.send(ContributeMetricFactsCommand, validPayload);

      await bus.send(ContributeMetricFactsCommand, {
        ...validPayload,
        // @ts-expect-error — an unknown member must be an excess-property error
        typo: 1,
      });

      expect(sent).toHaveLength(2);
    });

    it("rejects another command's payload", async () => {
      await bus.send(
        ContributeLogFactsCommand,
        // @ts-expect-error — a metric-facts payload is not a log-facts payload
        validPayload,
      );

      expect(sent).toEqual([validPayload]);
    });

    it("rejects an unknown member on a batch element", async () => {
      await bus.sendBatch(ContributeMetricFactsCommand, [
        validPayload,
        // @ts-expect-error — batch elements are checked the same way
        { ...validPayload, typo: 1 },
      ]);

      expect(sent).toHaveLength(2);
    });

    it("rejects an unknown member through a bound port", async () => {
      const contributeMetricFacts = bus.port(ContributeMetricFactsCommand);

      // @ts-expect-error — a port carries the same payload type
      await contributeMetricFacts({ ...validPayload, typo: 1 });

      expect(sent).toHaveLength(1);
    });
  });

  describe("when the command takes constructor DI", () => {
    /** @scenario A command taking constructor dependencies is dispatchable */
    it("binds through the bus, which a DefinedCommandClass constraint would refuse", () => {
      // Positive: the static constraint covers a `.withCommandInstance`
      // command. Narrowing the bus to `DefinedCommandClass` breaks this line.
      const port = bus.port(DiConstructedCommand);
      expect(typeof port).toBe("function");

      acceptsOnlyDefinedCommandClasses(ContributeMetricFactsCommand);
      acceptsOnlyDefinedCommandClasses(
        // @ts-expect-error — no zero-arg constructor, so `DefinedCommandClass`
        // excludes it. This is the correction the bus signature encodes.
        DiConstructedCommand,
      );
    });
  });
});
