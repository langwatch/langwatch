import { describe, expect, it, vi } from "vitest";
import { renderGroupKey } from "../dispatch/groupKey";
import { UndecodableStateError } from "../errors";
import type {
  BuiltFold,
  BuiltMap,
  BuiltPipeline,
  BuiltProcessManager,
  BuiltSubscriber,
  WireEvent,
} from "../pipeline/pipeline.types";
import type {
  CounterHandle,
  HistogramHandle,
  MetricLabels,
  Metrics,
} from "../ports/metrics";
import type { CommittedEvent, RegisteredPipeline } from "./contracts";
import { memoryEventLog } from "./memory";
import { createReplay } from "./replay";

/**
 * Replay is the sole bulk reader of event_log, re-running the same fold and
 * map executors delivery uses (ADR-108 decision 12). These tests are about
 * what it deliberately never runs, the version gate that stops it clobbering
 * a row a current build could not have written, and that it names its lanes
 * through the same renderer live dispatch uses rather than a hand-built
 * string.
 */

function fakeFold(args: {
  readonly name: string;
  readonly apply: BuiltFold["apply"];
}): BuiltFold {
  return {
    name: args.name,
    eventTypes: [],
    stateVersion: "v1",
    schemaHash: "v1",
    apply: args.apply,
  };
}

function fakeMap(args: {
  readonly name: string;
  readonly apply: BuiltMap["apply"];
}): BuiltMap {
  return { name: args.name, eventTypes: [], apply: args.apply };
}

function fakePipeline(args: {
  readonly aggregateType: string;
  readonly folds?: Readonly<Record<string, BuiltFold>>;
  readonly maps?: Readonly<Record<string, BuiltMap>>;
  readonly subscribers?: Readonly<Record<string, BuiltSubscriber>>;
  readonly processManagers?: Readonly<Record<string, BuiltProcessManager>>;
}): RegisteredPipeline {
  const pipeline = {
    name: args.aggregateType,
    prefix: undefined,
    eventTypes: [],
    commands: {},
    folds: args.folds ?? {},
    maps: args.maps ?? {},
    processManagers: args.processManagers ?? {},
    subscribers: args.subscribers ?? {},
  } as unknown as BuiltPipeline;
  return { pipeline, aggregateType: args.aggregateType };
}

function fakeRegistry(pipelines: readonly RegisteredPipeline[]): {
  all(): readonly RegisteredPipeline[];
} {
  return { all: () => pipelines };
}

function fakeMetrics(): Metrics & {
  counterCalls: {
    labels: MetricLabels | undefined;
    value: number | undefined;
  }[];
} {
  const counterCalls: {
    labels: MetricLabels | undefined;
    value: number | undefined;
  }[] = [];
  return {
    counterCalls,
    counter(): CounterHandle {
      return { inc: (labels, value) => counterCalls.push({ labels, value }) };
    },
    histogram(): HistogramHandle {
      return { observe: () => undefined };
    },
  };
}

let committedCounter = 0;

function committed(args: {
  readonly aggregateId: string;
  readonly eventType: string;
  readonly data: unknown;
  readonly occurredAt?: number;
}): CommittedEvent {
  committedCounter += 1;
  // The in-memory log dedupes on (tenant, type, id, idempotencyKey) — each
  // committed event in a test needs its own, or a second event for the same
  // aggregate collapses onto the first.
  const idempotencyKey = `${args.aggregateId}-${args.eventType}-${committedCounter}`;
  return {
    tenantId: "tenant-1",
    aggregateType: "trace",
    aggregateId: args.aggregateId,
    eventId: idempotencyKey,
    eventType: args.eventType,
    eventVersion: "1",
    idempotencyKey,
    occurredAt: args.occurredAt ?? 1000,
    payload: JSON.stringify(args.data),
  };
}

describe("replay", () => {
  describe("given an aggregate with existing event history", () => {
    /** @scenario Replaying a fold rebuilds its state from one aggregate's history */
    it("applies that aggregate's history through the fold's own executor", async () => {
      const eventLog = memoryEventLog();
      await eventLog.append([
        committed({
          aggregateId: "a1",
          eventType: "trace/tick",
          data: { n: 1 },
        }),
        committed({
          aggregateId: "a1",
          eventType: "trace/tick",
          data: { n: 2 },
        }),
      ]);
      const applySpy = vi.fn(
        async (delivery: { events: readonly WireEvent[] }) => ({
          events: delivery.events.length,
        }),
      );
      const registry = fakeRegistry([
        fakePipeline({
          aggregateType: "trace",
          folds: { summary: fakeFold({ name: "summary", apply: applySpy }) },
        }),
      ]);
      const replay = createReplay({ eventLog, registry });

      const report = await replay({
        tenantId: "tenant-1",
        aggregateType: "trace",
        aggregateId: "a1",
      });

      expect(applySpy).toHaveBeenCalledTimes(1);
      expect(applySpy.mock.calls[0]![0].key).toBe("a1");
      expect(applySpy.mock.calls[0]![0].events).toHaveLength(2);
      expect(report).toEqual({ events: 2, applied: 2, skippedByVersion: 0 });
    });
  });

  describe("given events across several aggregates within a tenant", () => {
    /** @scenario Replaying a map rebuilds its records from a bounded tenant range */
    it("applies the whole range through the map's own executor", async () => {
      const eventLog = memoryEventLog();
      await eventLog.append([
        committed({
          aggregateId: "a1",
          eventType: "trace/tick",
          data: { n: 1 },
        }),
        committed({
          aggregateId: "a2",
          eventType: "trace/tick",
          data: { n: 2 },
        }),
        committed({
          aggregateId: "a3",
          eventType: "trace/tick",
          data: { n: 3 },
        }),
      ]);
      const applySpy = vi.fn(
        async (delivery: { events: readonly WireEvent[] }) => ({
          written: delivery.events.length,
        }),
      );
      const registry = fakeRegistry([
        fakePipeline({
          aggregateType: "trace",
          maps: { rows: fakeMap({ name: "rows", apply: applySpy }) },
        }),
      ]);
      const replay = createReplay({ eventLog, registry });

      const report = await replay({
        tenantId: "tenant-1",
        aggregateType: "trace",
      });

      expect(applySpy.mock.calls[0]![0].events).toHaveLength(3);
      expect(report).toEqual({ events: 3, applied: 3, skippedByVersion: 0 });
    });

    /** @scenario A map replay across many aggregates writes in one batch */
    it("writes exactly once regardless of how many aggregates it spans", async () => {
      const eventLog = memoryEventLog();
      await eventLog.append([
        committed({
          aggregateId: "a1",
          eventType: "trace/tick",
          data: { n: 1 },
        }),
        committed({
          aggregateId: "a2",
          eventType: "trace/tick",
          data: { n: 2 },
        }),
        committed({
          aggregateId: "a3",
          eventType: "trace/tick",
          data: { n: 3 },
        }),
      ]);
      const applySpy = vi.fn(async () => ({ written: 3 }));
      const registry = fakeRegistry([
        fakePipeline({
          aggregateType: "trace",
          maps: { rows: fakeMap({ name: "rows", apply: applySpy }) },
        }),
      ]);
      const replay = createReplay({ eventLog, registry });

      await replay({ tenantId: "tenant-1", aggregateType: "trace" });

      expect(applySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a pipeline with a subscriber mounted on the same events as its fold", () => {
    /** @scenario Replay never runs a subscriber */
    it("never invokes the subscriber", async () => {
      const eventLog = memoryEventLog();
      await eventLog.append([
        committed({ aggregateId: "a1", eventType: "trace/tick", data: {} }),
      ]);
      const handleSpy = vi.fn();
      const registry = fakeRegistry([
        fakePipeline({
          aggregateType: "trace",
          folds: {
            summary: fakeFold({
              name: "summary",
              apply: async () => ({ events: 1 }),
            }),
          },
          subscribers: {
            audit: {
              name: "audit",
              eventTypes: ["trace/tick"],
              handle: handleSpy,
            },
          },
        }),
      ]);
      const replay = createReplay({ eventLog, registry });

      await replay({ tenantId: "tenant-1", aggregateType: "trace" });

      expect(handleSpy).not.toHaveBeenCalled();
    });
  });

  describe("given a pipeline with a process manager mounted on the same events as its fold", () => {
    /** @scenario Replay never runs a process manager */
    it("never invokes evolve and stages no intent", async () => {
      const eventLog = memoryEventLog();
      await eventLog.append([
        committed({ aggregateId: "a1", eventType: "trace/tick", data: {} }),
      ]);
      const evolveSpy = vi.fn();
      const registry = fakeRegistry([
        fakePipeline({
          aggregateType: "trace",
          folds: {
            summary: fakeFold({
              name: "summary",
              apply: async () => ({ events: 1 }),
            }),
          },
          processManagers: {
            settlement: {
              name: "settlement",
              enabled: true,
              eventTypes: ["trace/tick"],
              intentTypes: [],
              stateSchema: {
                safeParse: () => ({ success: true, data: {} }),
              } as never,
              stateVersion: "v1",
              schemaHash: "v1",
              intents: {},
              init: () => ({}),
              evolve: evolveSpy,
            },
          },
        }),
      ]);
      const replay = createReplay({ eventLog, registry });

      await replay({ tenantId: "tenant-1", aggregateType: "trace" });

      expect(evolveSpy).not.toHaveBeenCalled();
    });
  });

  describe("given an aggregate whose fold row was stamped with a state version this build does not recognise", () => {
    /** @scenario A fold row stamped with a version this build does not expect is skipped */
    it("skips that aggregate and counts it rather than writing over it", async () => {
      const eventLog = memoryEventLog();
      await eventLog.append([
        committed({
          aggregateId: "poisoned",
          eventType: "trace/tick",
          data: {},
        }),
      ]);
      const applySpy = vi.fn(async () => {
        throw new UndecodableStateError({
          projectionName: "summary",
          aggregateId: "poisoned",
          storedVersion: "old",
          expectedVersion: "v1",
        });
      });
      const registry = fakeRegistry([
        fakePipeline({
          aggregateType: "trace",
          folds: { summary: fakeFold({ name: "summary", apply: applySpy }) },
        }),
      ]);
      const replay = createReplay({ eventLog, registry });

      const report = await replay({
        tenantId: "tenant-1",
        aggregateType: "trace",
      });

      expect(report).toEqual({ events: 1, applied: 0, skippedByVersion: 1 });
    });
  });

  describe("given a mix of aggregates, some replayable and one stamped with an unrecognised version", () => {
    /** @scenario The report accounts for every event scanned, applied, and skipped */
    it("reports scanned, applied and skipped counts that add up", async () => {
      const eventLog = memoryEventLog();
      await eventLog.append([
        committed({ aggregateId: "good", eventType: "trace/tick", data: {} }),
        committed({ aggregateId: "good", eventType: "trace/tick", data: {} }),
        committed({
          aggregateId: "poisoned",
          eventType: "trace/tick",
          data: {},
        }),
      ]);
      const applySpy = vi.fn(
        async (delivery: { key: string; events: readonly WireEvent[] }) => {
          if (delivery.key === "poisoned") {
            throw new UndecodableStateError({
              projectionName: "summary",
              aggregateId: "poisoned",
              storedVersion: "old",
              expectedVersion: "v1",
            });
          }
          return { events: delivery.events.length };
        },
      );
      const registry = fakeRegistry([
        fakePipeline({
          aggregateType: "trace",
          folds: { summary: fakeFold({ name: "summary", apply: applySpy }) },
        }),
      ]);
      const replay = createReplay({ eventLog, registry });

      const report = await replay({
        tenantId: "tenant-1",
        aggregateType: "trace",
      });

      expect(report).toEqual({ events: 3, applied: 2, skippedByVersion: 1 });
    });
  });

  describe("given a fold replayed for a specific aggregate", () => {
    /** @scenario Replay names its lane through the group-key renderer, not a hand-built string */
    it("records a lane exactly matching the group-key renderer's output", async () => {
      const eventLog = memoryEventLog();
      await eventLog.append([
        committed({ aggregateId: "a1", eventType: "trace/tick", data: {} }),
      ]);
      const metrics = fakeMetrics();
      const registry = fakeRegistry([
        fakePipeline({
          aggregateType: "trace",
          folds: {
            summary: fakeFold({
              name: "summary",
              apply: async () => ({ events: 1 }),
            }),
          },
        }),
      ]);
      const replay = createReplay({ eventLog, registry, metrics });

      await replay({
        tenantId: "tenant-1",
        aggregateType: "trace",
        aggregateId: "a1",
      });

      const expectedLane = renderGroupKey({
        tenantId: "tenant-1",
        lane: { kind: "fold", name: "summary" },
        scope: { kind: "aggregate", aggregateType: "trace", aggregateId: "a1" },
      });
      expect(
        metrics.counterCalls.some((call) => call.labels?.lane === expectedLane),
      ).toBe(true);
    });
  });

  describe("given a pipeline with both a fold and a map projection", () => {
    /** @scenario Naming one projection replays only that one */
    it("replays only the named projection", async () => {
      const eventLog = memoryEventLog();
      await eventLog.append([
        committed({ aggregateId: "a1", eventType: "trace/tick", data: {} }),
      ]);
      const foldApply = vi.fn(async () => ({ events: 1 }));
      const mapApply = vi.fn(async () => ({ written: 1 }));
      const registry = fakeRegistry([
        fakePipeline({
          aggregateType: "trace",
          folds: { summary: fakeFold({ name: "summary", apply: foldApply }) },
          maps: { rows: fakeMap({ name: "rows", apply: mapApply }) },
        }),
      ]);
      const replay = createReplay({ eventLog, registry });

      await replay({
        tenantId: "tenant-1",
        aggregateType: "trace",
        projections: ["summary"],
      });

      expect(foldApply).toHaveBeenCalledTimes(1);
      expect(mapApply).not.toHaveBeenCalled();
    });
  });

  describe("given no pipeline is registered for the requested aggregate type", () => {
    /** @scenario A replay request naming no registered pipeline is rejected */
    it("rejects rather than silently reporting nothing happened", async () => {
      const eventLog = memoryEventLog();
      const registry = fakeRegistry([]);
      const replay = createReplay({ eventLog, registry });

      await expect(
        replay({ tenantId: "tenant-1", aggregateType: "unknown" }),
      ).rejects.toThrow();
    });
  });
});
