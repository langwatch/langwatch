import { describe, expect, it } from "vitest";
import type {
  BuiltPipeline,
  CommittedEvent,
  EventLog,
  LaneQueue,
  Metrics,
  Registry,
  StagedJob,
} from "./contracts";
import { createEventProducer } from "./producer";

function committedEvent(
  overrides: Partial<CommittedEvent> = {},
): CommittedEvent {
  return {
    tenantId: "tenant-a",
    aggregateType: "trace",
    aggregateId: "trace-1",
    eventId: "event-1",
    eventType: "spanReceived",
    eventVersion: "v1",
    idempotencyKey: "idem-1",
    occurredAt: Date.UTC(2026, 0, 15, 10, 30, 0, 0),
    payload: '{"traceId":"trace-1"}',
    ...overrides,
  };
}

function fakePipeline(overrides: Record<string, unknown> = {}): BuiltPipeline {
  return {
    name: "test-pipeline",
    prefix: undefined,
    eventTypes: [],
    commands: {},
    folds: {},
    maps: {},
    subscribers: {},
    processManagers: {},
    ...overrides,
  } as unknown as BuiltPipeline;
}

interface RegistryConfig {
  folds?: readonly { pipeline: BuiltPipeline; name: string }[];
  maps?: readonly { pipeline: BuiltPipeline; name: string }[];
  subscribers?: readonly { pipeline: BuiltPipeline; name: string }[];
  processManagers?: readonly { pipeline: BuiltPipeline; name: string }[];
}

function fakeRegistry(config: RegistryConfig): Registry {
  return {
    register() {},
    all: () => [],
    commandNames: () => [],
    findCommand: () => null,
    foldsFor: () => config.folds ?? [],
    mapsFor: () => config.maps ?? [],
    subscribersFor: () => config.subscribers ?? [],
    processManagersFor: () => config.processManagers ?? [],
    assertResolvable() {},
  };
}

function fakeEventLog(): EventLog & {
  readonly appendCalls: (readonly CommittedEvent[])[];
} {
  const appendCalls: (readonly CommittedEvent[])[] = [];
  return {
    appendCalls,
    async append(events) {
      appendCalls.push(events);
    },
    async *scan() {
      yield* [];
    },
  };
}

function fakeQueue(
  onStage?: (jobs: readonly StagedJob[]) => void | Promise<void>,
): LaneQueue & { readonly stageCalls: (readonly StagedJob[])[] } {
  const stageCalls: (readonly StagedJob[])[] = [];
  return {
    stageCalls,
    async stage(jobs) {
      stageCalls.push(jobs);
      if (onStage) await onStage(jobs);
    },
    async claim() {
      return null;
    },
    async settle() {},
    async retry() {},
    async park() {},
    async depth() {
      return 0;
    },
  };
}

function fakeMetrics(): Metrics & {
  readonly incCalls: { name: string; labels?: Record<string, string> }[];
} {
  const incCalls: { name: string; labels?: Record<string, string> }[] = [];
  return {
    incCalls,
    counter(spec) {
      return {
        inc: (labels) => incCalls.push({ name: spec.name, labels }),
      };
    },
    histogram() {
      return { observe: () => undefined };
    },
  };
}

describe("given createEventProducer()", () => {
  describe("when an event is published", () => {
    /** @scenario an event reaches the log before any lane is fanned out to */
    it("calls the event log's append before the queue is staged", async () => {
      const order: string[] = [];
      const eventLog: EventLog = {
        async append() {
          order.push("append");
        },
        async *scan() {
          yield* [];
        },
      };
      const queue = fakeQueue(() => {
        order.push("stage");
      });
      const registry = fakeRegistry({
        subscribers: [
          {
            pipeline: fakePipeline({
              subscribers: { sub: { scopeFor: () => ({ kind: "global" }) } },
            }),
            name: "sub",
          },
        ],
      });
      const producer = createEventProducer({ eventLog, queue, registry });

      await producer.publish([committedEvent()]);

      expect(order).toEqual(["append", "stage"]);
    });

    /** @scenario a staging failure never fails the write that already landed */
    it("does not fail publishing when the lane queue rejects every job", async () => {
      const eventLog = fakeEventLog();
      const queue: LaneQueue = {
        async stage() {
          throw new Error("queue unavailable");
        },
        async claim() {
          return null;
        },
        async settle() {},
        async retry() {},
        async park() {},
        async depth() {
          return 0;
        },
      };
      const registry = fakeRegistry({
        subscribers: [
          {
            pipeline: fakePipeline({
              subscribers: { sub: { scopeFor: () => ({ kind: "global" }) } },
            }),
            name: "sub",
          },
        ],
      });
      const producer = createEventProducer({ eventLog, queue, registry });

      await expect(
        producer.publish([committedEvent()]),
      ).resolves.toBeUndefined();
      expect(eventLog.appendCalls).toHaveLength(1);
    });

    /** @scenario the payload string is never re-encoded on its way to the log or a lane */
    it("carries the exact payload string to both the event log and the staged job body", async () => {
      const payload = '{\n  "traceId": "trace-1",\n  "value": 42\n}';
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        subscribers: [
          {
            pipeline: fakePipeline({
              subscribers: { sub: { scopeFor: () => ({ kind: "global" }) } },
            }),
            name: "sub",
          },
        ],
      });
      const producer = createEventProducer({ eventLog, queue, registry });

      await producer.publish([committedEvent({ payload })]);

      expect(eventLog.appendCalls[0]?.[0]?.payload).toBe(payload);
      expect(queue.stageCalls[0]?.[0]?.body).toBe(payload);
    });

    /** @scenario a fold's lane is named by the pipeline's own aggregate id map, not a hand-written key */
    it("scopes a fold's lane to the aggregate id the pipeline's own id map resolves", async () => {
      const calls: { eventType: string; payload: unknown }[] = [];
      const pipeline = fakePipeline({
        folds: { traceSummary: {} },
        aggregateIdFor: (eventType: string, payload: unknown) => {
          calls.push({ eventType, payload });
          return "resolved-aggregate-id";
        },
      });
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        folds: [{ pipeline, name: "traceSummary" }],
      });
      const producer = createEventProducer({ eventLog, queue, registry });
      const event = committedEvent({ payload: '{"traceId":"trace-1"}' });

      await producer.publish([event]);

      const job = queue.stageCalls[0]?.[0];
      expect(job?.descriptor.scope).toEqual({
        kind: "aggregate",
        aggregateType: event.aggregateType,
        aggregateId: "resolved-aggregate-id",
      });
      expect(calls).toEqual([
        { eventType: event.eventType, payload: { traceId: "trace-1" } },
      ]);
    });

    /** @scenario a process manager's lane is scoped the same way a fold's is */
    it("scopes a process manager's lane the same way it scopes a fold's", async () => {
      const pipeline = fakePipeline({
        processManagers: { settlement: {} },
        aggregateIdFor: () => "resolved-aggregate-id",
      });
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        processManagers: [{ pipeline, name: "settlement" }],
      });
      const producer = createEventProducer({ eventLog, queue, registry });
      const event = committedEvent();

      await producer.publish([event]);

      expect(queue.stageCalls[0]?.[0]?.descriptor.scope).toEqual({
        kind: "aggregate",
        aggregateType: event.aggregateType,
        aggregateId: "resolved-aggregate-id",
      });
    });

    /** @scenario a map's lane is scoped by its own declaration, not by the aggregate */
    it("scopes a map's lane to what the map itself declares", async () => {
      const declaredScope = {
        kind: "partition" as const,
        parts: ["tenant-a", "shard-1"],
      };
      const pipeline = fakePipeline({
        maps: { spanStorage: { scopeFor: () => declaredScope } },
      });
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        maps: [{ pipeline, name: "spanStorage" }],
      });
      const producer = createEventProducer({ eventLog, queue, registry });

      await producer.publish([committedEvent()]);

      expect(queue.stageCalls[0]?.[0]?.descriptor.scope).toEqual(declaredScope);
    });

    /** @scenario a throwing enqueue predicate mints the job rather than losing it */
    it("stages the job anyway when the enqueue predicate throws, and counts it", async () => {
      const pipeline = fakePipeline({
        subscribers: {
          sub: {
            scopeFor: () => ({ kind: "global" }),
            enqueueFilter: () => {
              throw new Error("cannot decide");
            },
          },
        },
      });
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        subscribers: [{ pipeline, name: "sub" }],
      });
      const metrics = fakeMetrics();
      const producer = createEventProducer({
        eventLog,
        queue,
        registry,
        metrics,
      });

      await producer.publish([committedEvent()]);

      expect(queue.stageCalls[0]).toHaveLength(1);
      expect(metrics.incCalls).toContainEqual({
        name: "es_producer_fanout_issues_total",
        labels: { stage: "enqueueFilter" },
      });
    });

    /** @scenario an enqueue predicate that declines is honoured */
    it("stages no job when the enqueue predicate returns false", async () => {
      const pipeline = fakePipeline({
        subscribers: {
          sub: {
            scopeFor: () => ({ kind: "global" }),
            enqueueFilter: () => false,
          },
        },
      });
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        subscribers: [{ pipeline, name: "sub" }],
      });
      const producer = createEventProducer({ eventLog, queue, registry });

      await producer.publish([committedEvent()]);

      expect(queue.stageCalls).toHaveLength(0);
    });

    /** @scenario reference staging swaps the payload for a small reference when one can be built */
    it("stages the reference the hook builds instead of the whole payload", async () => {
      const pipeline = fakePipeline({
        maps: {
          spanStorage: {
            scopeFor: () => ({ kind: "event", eventId: "event-1" }),
            stageReference: () => "ref:event-1",
          },
        },
      });
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        maps: [{ pipeline, name: "spanStorage" }],
      });
      const producer = createEventProducer({ eventLog, queue, registry });

      await producer.publish([committedEvent()]);

      expect(queue.stageCalls[0]?.[0]?.body).toBe("ref:event-1");
    });

    /** @scenario reference staging falls back to the whole body when no reference can be built */
    it("stages the whole payload when the reference hook builds nothing", async () => {
      const payload = '{"traceId":"trace-1"}';
      const pipeline = fakePipeline({
        maps: {
          spanStorage: {
            scopeFor: () => ({ kind: "event", eventId: "event-1" }),
            stageReference: () => undefined,
          },
        },
      });
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        maps: [{ pipeline, name: "spanStorage" }],
      });
      const producer = createEventProducer({ eventLog, queue, registry });

      await producer.publish([committedEvent({ payload })]);

      expect(queue.stageCalls[0]?.[0]?.body).toBe(payload);
    });

    /** @scenario a member with no declared scope loses only its own work */
    it("keeps the subscriber's job when the map beside it declares no scope", async () => {
      const mapPipeline = fakePipeline({ maps: { broken: {} } });
      const subPipeline = fakePipeline({
        subscribers: { sub: { scopeFor: () => ({ kind: "global" }) } },
      });
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        maps: [{ pipeline: mapPipeline, name: "broken" }],
        subscribers: [{ pipeline: subPipeline, name: "sub" }],
      });
      const metrics = fakeMetrics();
      const producer = createEventProducer({
        eventLog,
        queue,
        registry,
        metrics,
      });

      await expect(
        producer.publish([committedEvent()]),
      ).resolves.toBeUndefined();

      const jobs = queue.stageCalls[0] ?? [];
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.descriptor.lane).toEqual({
        kind: "subscriber",
        name: "sub",
      });
      expect(metrics.incCalls).toContainEqual({
        name: "es_producer_fanout_issues_total",
        labels: { stage: "member" },
      });
    });

    /** @scenario one event's cost is measured once and shared by every lane it reaches */
    it("gives every job for one event the same byte cost, equal to the payload's byte length", async () => {
      const payload = '{"traceId":"trace-1"}';
      const foldPipeline = fakePipeline({
        folds: { traceSummary: {} },
        aggregateIdFor: () => "trace-1",
      });
      const mapPipeline = fakePipeline({
        maps: {
          spanStorage: {
            scopeFor: () => ({ kind: "event", eventId: "event-1" }),
          },
        },
      });
      const eventLog = fakeEventLog();
      const queue = fakeQueue();
      const registry = fakeRegistry({
        folds: [{ pipeline: foldPipeline, name: "traceSummary" }],
        maps: [{ pipeline: mapPipeline, name: "spanStorage" }],
      });
      const producer = createEventProducer({ eventLog, queue, registry });

      await producer.publish([committedEvent({ payload })]);

      const jobs = queue.stageCalls[0] ?? [];
      expect(jobs).toHaveLength(2);
      const expectedBytes = Buffer.byteLength(payload, "utf8");
      for (const job of jobs) expect(job.costBytes).toBe(expectedBytes);
    });
  });
});
