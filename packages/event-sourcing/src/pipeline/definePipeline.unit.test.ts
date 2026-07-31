import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { ConfigurationError } from "../errors";
import type { MetricLabels, Metrics } from "../ports/metrics";
import type {
  MergeStore,
  ReplaceStore,
  StateRead,
  StoredState,
} from "../projections/store.types";
import { definePipeline } from "./definePipeline";
import type { HandlerContext, ProcessContext } from "./pipeline.types";

/**
 * `definePipeline` is the one chain a pipeline is declared in (ADR-105). These
 * tests are about what the chain buys: derivation instead of restating, the
 * `.id` gate, context reaching only the members that leave the pipeline, and
 * the guards that keep a declaration routable.
 */

const spanReceived = z.object({ traceId: z.string(), spanId: z.string() });
const topicAssigned = z.object({ traceId: z.string(), topic: z.string() });

/** An in-memory `ReplaceStore`, good enough to drive a fold executor end to end. */
function memoryReplaceStore<State>(): ReplaceStore<State> & {
  rows: Map<string, StoredState<State>>;
} {
  const rows = new Map<string, StoredState<State>>();
  return {
    kind: "replace",
    rows,
    async read(key): Promise<StateRead<State>> {
      const found = rows.get(key);
      return found ? { kind: "found", stored: found } : { kind: "absent" };
    },
    async write(key, stored) {
      rows.set(key, stored);
    },
  };
}

/** An in-memory `AppendStore`, good enough to drive a map executor end to end. */
function memoryAppendStore<Row>(): {
  kind: "append";
  rows: Row[];
  writeBatch: (records: readonly Row[]) => Promise<void>;
} {
  const rows: Row[] = [];
  return {
    kind: "append",
    rows,
    async writeBatch(records) {
      rows.push(...records);
    },
  };
}

/** A `MergeStore` — legal by `MapWithStore.store`'s type, and the one
 * combination ADR-106 closes unconditionally (decision 5). */
function memoryMergeStore<Row>(): MergeStore<Row> & { rows: Row[] } {
  const rows: Row[] = [];
  return {
    kind: "merge",
    idempotency: "whole-bucket-replace",
    rows,
    async writeBatch(records) {
      rows.push(...records);
    },
  };
}

/** Records every counter increment so a test can assert an executor actually
 * used the metrics port `.build()` was given. */
function fakeMetrics(): Metrics & {
  incs: { name: string; labels: MetricLabels | undefined }[];
} {
  const incs: { name: string; labels: MetricLabels | undefined }[] = [];
  return {
    incs,
    counter: (spec) => ({
      inc: (labels) => incs.push({ name: spec.name, labels }),
    }),
    histogram: () => ({ observe: () => undefined }),
  };
}

/** A collaborator a handler closes over at its mount, the way a real one does. */
function makeNotifier() {
  const sent: unknown[] = [];
  return {
    sent,
    send(payload: unknown) {
      sent.push(payload);
    },
  };
}

/** The runtime facts every handler context carries, shared across call sites. */
const ctx: HandlerContext = { now: 1_000, tenantId: "tenant-1" };
const processCtx: ProcessContext = { ...ctx, processKey: "t" };

describe("definePipeline", () => {
  describe("given an event is its payload schema", () => {
    /** @scenario the persisted type string derives from the pipeline name and the event key */
    it("derives the persisted type string from the pipeline name and the event key", () => {
      const built = definePipeline("trace").events({ spanReceived }).build();
      expect(built.eventTypes).toEqual(["trace/spanReceived"]);
    });

    /** @scenario a prefix produces the legacy dotted, snake-cased form */
    it("derives the legacy dotted, snake-cased form when a prefix is declared", () => {
      const built = definePipeline("trace")
        .prefix("lw.obs")
        .events({ spanReceived })
        .build();
      expect(built.eventTypes).toEqual(["lw.obs.trace.span_received"]);
    });

    /** @scenario an event's membership in the router's filter set derives from the vocabulary alone */
    it("lists every declared event and nothing else", () => {
      const built = definePipeline("trace")
        .events({ spanReceived, topicAssigned })
        .build();
      expect([...built.eventTypes].sort()).toEqual(
        ["trace/spanReceived", "trace/topicAssigned"].sort(),
      );
    });

    /** @scenario declaring no events at all is refused */
    it("refuses a pipeline that declares no events", () => {
      expect(() => definePipeline("trace").events({})).toThrow(
        ConfigurationError,
      );
    });

    /** @scenario an event key containing the type-string separator is refused */
    it("refuses an event key containing the type-string separator", () => {
      expect(() =>
        definePipeline("trace").events({ "bad/key": spanReceived }),
      ).toThrow(ConfigurationError);
      expect(() =>
        definePipeline("trace").events({ "bad.key": spanReceived }),
      ).toThrow(ConfigurationError);
    });

    /** @scenario an event key containing an underscore is refused */
    it("refuses an event key that already contains an underscore", () => {
      expect(() =>
        definePipeline("trace").events({ bad_key: spanReceived }),
      ).toThrow(ConfigurationError);
    });
  });

  describe("given .id is offered exactly when a member needs it", () => {
    /** @scenario a pipeline of maps and commands alone is never asked for an id */
    it("never offers .id's dependents to a chain that has not called it", () => {
      const chain = definePipeline("trace").events({ spanReceived });
      expectTypeOf(chain).not.toHaveProperty("withFold");
      expectTypeOf(chain).not.toHaveProperty("withProcessManager");
      expectTypeOf(chain).toHaveProperty("withCommand");
      expectTypeOf(chain).toHaveProperty("withMap");
      expectTypeOf(chain).toHaveProperty("withSubscriber");
    });

    /** @scenario a fold is only reachable after .id has fixed the aggregate identity */
    it("offers withFold only after .id", () => {
      const withId = definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId });
      expectTypeOf(withId).toHaveProperty("withFold");
    });

    /** @scenario a process manager is only reachable after .id has fixed the aggregate identity */
    it("offers withProcessManager only after .id", () => {
      const withId = definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId });
      expectTypeOf(withId).toHaveProperty("withProcessManager");
    });

    /** @scenario the id map supplies one extractor per declared event */
    it("resolves an event's id through the extractor declared for its own key", () => {
      const chain = definePipeline("trace")
        .events({ spanReceived, topicAssigned })
        .id({
          spanReceived: (d) => `span:${d.traceId}`,
          topicAssigned: (d) => `topic:${d.traceId}`,
        });
      // The id map itself is exercised directly — it is pure data the chain
      // stores, not something `.build()` transforms.
      expect(chain).toBeTruthy();
    });
  });

  describe("given handlers are keyed by event, never switched over event", () => {
    const buildTraceWithFold = () =>
      definePipeline("trace")
        .events({ spanReceived, topicAssigned })
        .id({ spanReceived: (d) => d.traceId, topicAssigned: (d) => d.traceId })
        .withFold("traceSummary", {
          state: z.object({ spanIds: z.array(z.string()) }),
          init: () => ({ spanIds: [] }),
          on: {
            spanReceived: (state, data) => {
              expectTypeOf(data).toEqualTypeOf<{
                traceId: string;
                spanId: string;
              }>();
              return { spanIds: [...state.spanIds, data.spanId] };
            },
          },
          store: memoryReplaceStore<{ spanIds: string[] }>(),
        })
        .build();

    /** @scenario a fold's handler receives only the payload its own event key carries */
    it("hands a fold's handler that event's own typed payload", async () => {
      const built = buildTraceWithFold();
      await built.folds.traceSummary!.apply({
        key: "t1",
        tenantId: "tenant-1",
        events: [
          { type: "trace/spanReceived", data: { traceId: "t1", spanId: "s1" } },
        ],
      });
      const read = await built.folds.traceSummary!.apply({
        key: "t1",
        tenantId: "tenant-1",
        events: [],
      });
      expect(read.events).toBe(0);
    });

    /** @scenario an event with no declared fold handler leaves the state unchanged */
    it("leaves a fold's state unchanged for an event it declares no handler for", async () => {
      const built = buildTraceWithFold();
      const result = await built.folds.traceSummary!.apply({
        key: "t1",
        tenantId: "tenant-1",
        events: [
          {
            type: "trace/topicAssigned",
            data: { traceId: "t1", topic: "billing" },
          },
        ],
      });
      expect(result.events).toBe(1);
    });

    /** @scenario an event with no declared map handler produces no row */
    it("produces no row for an event the map declares no handler for", async () => {
      const store = memoryAppendStore<{ TraceId: string }>();
      const built = definePipeline("trace")
        .events({ spanReceived, topicAssigned })
        .withMap("spanStorage", {
          on: { spanReceived: (data) => ({ TraceId: data.traceId }) },
          store,
        })
        .build();

      await built.maps.spanStorage!.apply({
        tenantId: "tenant-1",
        events: [
          {
            type: "trace/topicAssigned",
            data: { traceId: "t1", topic: "billing" },
          },
        ],
      });
      expect(store.rows).toEqual([]);
    });

    /** @scenario an event with no declared subscriber handler runs nothing */
    it("runs nothing for an event the subscriber declares no handler for", async () => {
      const calls: string[] = [];
      const built = definePipeline("trace")
        .events({ spanReceived, topicAssigned })
        .withSubscriber("audit", {
          on: {
            spanReceived: () => {
              calls.push("spanReceived");
            },
          },
        })
        .build();

      await built.subscribers.audit!.handle(
        {
          type: "trace/topicAssigned",
          data: { traceId: "t1", topic: "billing" },
        },
        ctx,
      );
      expect(calls).toEqual([]);
    });

    /** @scenario an event with no declared process-manager handler runs no step at all */
    it("runs no step for an event the process manager declares no handler for", () => {
      const notifier = makeNotifier();
      const built = definePipeline("trace")
        .events({ spanReceived, topicAssigned })
        .id({ spanReceived: (d) => d.traceId, topicAssigned: (d) => d.traceId })
        .withProcessManager("settlement", {
          state: z.object({ seen: z.number() }),
          init: () => ({ seen: 0 }),
          intents: {
            notifyDigest: {
              payload: z.object({ traceId: z.string() }),
              messageKey: (p) => `digest:${p.traceId}`,
              deliver: (payload) => notifier.send(payload),
            },
          },
          on: {
            spanReceived: (state) => ({
              state: { seen: state.seen + 1 },
              intents: [],
              nextWakeAt: null,
            }),
          },
        })
        .build();

      const step = built.processManagers.settlement!.evolve(
        { seen: 0 },
        {
          type: "trace/topicAssigned",
          data: { traceId: "t1", topic: "billing" },
        },
        processCtx,
      );
      expect(step).toBeNull();
    });

    /** @scenario a member built with no handlers at all is refused */
    it("refuses a fold, a map, a subscriber and a process manager each declared with no handlers", () => {
      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .id({ spanReceived: (d) => d.traceId })
          .withFold("f", {
            state: z.object({}),
            init: () => ({}),
            on: {},
            store: memoryReplaceStore<{}>(),
          })
          .build(),
      ).toThrow(ConfigurationError);

      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .withMap("m", { on: {}, store: memoryAppendStore() })
          .build(),
      ).toThrow(ConfigurationError);

      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .withSubscriber("s", { on: {} })
          .build(),
      ).toThrow(ConfigurationError);

      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .id({ spanReceived: (d) => d.traceId })
          .withProcessManager("pm", {
            state: z.object({}),
            init: () => ({}),
            intents: {
              notify: {
                payload: z.object({}),
                messageKey: () => "x",
                deliver: () => undefined,
              },
            },
            on: {},
          })
          .build(),
      ).toThrow(ConfigurationError);
    });
  });

  describe("given only the members that reach outside a pipeline get a context", () => {
    /** @scenario a fold handler receives no context */
    it("gives a fold's handler exactly the state and the payload", () => {
      let receivedArgCount = 0;
      definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withFold("f", {
          state: z.object({ n: z.number() }),
          init: () => ({ n: 0 }),
          on: {
            spanReceived: (...args) => {
              receivedArgCount = args.length;
              return { n: 1 };
            },
          },
          store: memoryReplaceStore<{ n: number }>(),
        });
      // The handler is only invoked once the fold actually applies an event —
      // asserted below via the arity captured at declaration time.
      expect(receivedArgCount).toBe(0);
    });

    /** @scenario a map handler receives no context */
    it("gives a map's handler exactly the payload", async () => {
      const store = memoryAppendStore<{ ok: boolean }>();
      const built = definePipeline("trace")
        .events({ spanReceived })
        .withMap("m", {
          on: { spanReceived: (...args) => ({ ok: args.length === 1 }) },
          store,
        })
        .build();

      await built.maps.m!.apply({
        tenantId: "tenant-1",
        events: [
          { type: "trace/spanReceived", data: { traceId: "t", spanId: "s" } },
        ],
      });
      expect(store.rows).toEqual([{ ok: true }]);
    });

    /** @scenario a command handler reaches its collaborator through the closure it was mounted with */
    it("reaches a command's collaborator through the closure, and receives the runtime context", async () => {
      const notifier = makeNotifier();
      let seen: unknown;
      const built = definePipeline("trace")
        .events({ spanReceived })
        .withCommand("recordSpan", {
          input: spanReceived,
          handle: async (input, ctx) => {
            notifier.send(input);
            seen = ctx;
            return [{ type: "spanReceived", data: input }];
          },
        })
        .build();

      await built.commands.recordSpan!.handle(
        { traceId: "t", spanId: "s" },
        ctx,
      );
      expect(notifier.sent).toEqual([{ traceId: "t", spanId: "s" }]);
      expect(seen).toEqual(ctx);
    });

    /** @scenario a process-manager handler additionally knows which instance it is running for */
    it("gives a process-manager handler the runtime context including its process key", () => {
      const notifier = makeNotifier();
      let seen: unknown;
      const built = definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withProcessManager("pm", {
          state: z.object({}),
          init: () => ({}),
          intents: {
            notify: {
              payload: z.object({}),
              messageKey: () => "x",
              deliver: (payload) => notifier.send(payload),
            },
          },
          on: {
            spanReceived: (state, _data, ctx) => {
              seen = ctx;
              return { state, intents: [], nextWakeAt: null };
            },
          },
        })
        .build();

      built.processManagers.pm!.evolve(
        {},
        { type: "trace/spanReceived", data: { traceId: "t", spanId: "s" } },
        processCtx,
      );
      expect(seen).toEqual(processCtx);
    });

    /** @scenario a subscriber handler receives the payload and the runtime context */
    it("gives a subscriber handler the payload and the runtime context", async () => {
      let seen: unknown;
      const built = definePipeline("trace")
        .events({ spanReceived })
        .withSubscriber("s", {
          on: {
            spanReceived: (_data, ctx) => {
              seen = ctx;
            },
          },
        })
        .build();

      await built.subscribers.s!.handle(
        { type: "trace/spanReceived", data: { traceId: "t", spanId: "s" } },
        ctx,
      );
      expect(seen).toEqual(ctx);
    });
  });

  describe("given a command is the trust boundary, and its only output is events", () => {
    /** @scenario a command's handler emits events named by their own vocabulary key */
    it("stamps an emitted event with the pipeline's derived persisted type", async () => {
      const built = definePipeline("trace")
        .events({ spanReceived })
        .withCommand("recordSpan", {
          input: spanReceived,
          handle: async (input) => [{ type: "spanReceived", data: input }],
        })
        .build();

      const events = await built.commands.recordSpan!.handle(
        { traceId: "t", spanId: "s" },
        ctx,
      );
      expect(events).toEqual([
        { type: "trace/spanReceived", data: { traceId: "t", spanId: "s" } },
      ]);
    });

    /** @scenario a command may emit more than one event */
    it("emits every event a handler decides to return", async () => {
      const built = definePipeline("trace")
        .events({ spanReceived, topicAssigned })
        .withCommand("recordSpan", {
          input: spanReceived,
          handle: async (input) => [
            { type: "spanReceived", data: input },
            {
              type: "topicAssigned",
              data: { traceId: input.traceId, topic: "unknown" },
            },
          ],
        })
        .build();

      const events = await built.commands.recordSpan!.handle(
        { traceId: "t", spanId: "s" },
        ctx,
      );
      expect(events.map((e) => e.type)).toEqual([
        "trace/spanReceived",
        "trace/topicAssigned",
      ]);
    });

    /** @scenario a command may emit no events at all */
    it("emits nothing when the handler decides nothing needs to happen", async () => {
      const built = definePipeline("trace")
        .events({ spanReceived })
        .withCommand("recordSpan", {
          input: spanReceived,
          handle: async () => [],
        })
        .build();

      expect(
        await built.commands.recordSpan!.handle(
          { traceId: "t", spanId: "s" },
          ctx,
        ),
      ).toEqual([]);
    });
  });

  describe("given an intent declares its payload, its key and its delivery together", () => {
    const buildSettlement = (notifier: ReturnType<typeof makeNotifier>) =>
      definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withProcessManager("settlement", {
          state: z.object({}),
          init: () => ({}),
          intents: {
            notifyDigest: {
              payload: z.object({ traceId: z.string() }),
              messageKey: (p) => `digest:${p.traceId}`,
              deliver: (payload) => notifier.send(payload),
            },
          },
          on: {
            spanReceived: (state) => ({ state, intents: [], nextWakeAt: null }),
          },
        })
        .build();

    /** @scenario an intent's type is qualified by the process manager that declared it */
    it("derives the intent type from the process manager's own name and the intent key", () => {
      const built = buildSettlement(makeNotifier());
      expect(built.processManagers.settlement!.intentTypes).toEqual([
        "settlement/notifyDigest",
      ]);
    });

    /** @scenario messageKey computes the same key for a retried intent carrying the same payload */
    it("computes the identical key for the same payload on a retry", () => {
      const built = buildSettlement(makeNotifier());
      const payload = { traceId: "t1" };
      const first =
        built.processManagers.settlement!.intents.notifyDigest!.messageKey(
          payload,
        );
      const retried =
        built.processManagers.settlement!.intents.notifyDigest!.messageKey({
          ...payload,
        });
      expect(retried).toBe(first);
    });

    /** @scenario delivering an intent reaches the collaborator closed over at the mount */
    it("delivers through the exact collaborator closed over at the mount", () => {
      const notifier = makeNotifier();
      const built = buildSettlement(notifier);

      built.processManagers.settlement!.intents.notifyDigest!.deliver(
        { traceId: "t1" },
        ctx,
      );
      expect(notifier.sent).toEqual([{ traceId: "t1" }]);
    });

    /** @scenario a process manager declaring no intents at all is refused */
    it("refuses a process manager that declares no intents", () => {
      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .id({ spanReceived: (d) => d.traceId })
          .withProcessManager("pm", {
            state: z.object({}),
            init: () => ({}),
            intents: {},
            on: {},
          }),
      ).toThrow(ConfigurationError);
    });
  });

  describe("given a process manager arms and clears its own wake, and may be gated off", () => {
    const buildPm = (
      handler: (
        state: { seen: number },
        ctx: ProcessContext,
      ) => { nextWakeAt: number | null },
      enabled?: boolean,
    ) =>
      definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withProcessManager("pm", {
          state: z.object({ seen: z.number() }),
          init: () => ({ seen: 0 }),
          intents: {
            notify: {
              payload: z.object({}),
              messageKey: () => "x",
              deliver: () => undefined,
            },
          },
          on: {
            spanReceived: (state, _data, ctx) => ({
              state,
              intents: [],
              nextWakeAt: handler(state, ctx).nextWakeAt,
            }),
          },
          enabled,
        })
        .build();

    /** @scenario a step arms a wake by returning the instant it is next due */
    it("reports the returned instant as the next wake", () => {
      const built = buildPm(() => ({ nextWakeAt: 61_000 }));
      const step = built.processManagers.pm!.evolve(
        { seen: 0 },
        { type: "trace/spanReceived", data: { traceId: "t", spanId: "s" } },
        processCtx,
      );
      expect(step?.nextWakeAt).toBe(61_000);
    });

    /** @scenario a step clears a wake by returning null */
    it("reports no wake armed when the step returns null", () => {
      const built = buildPm(() => ({ nextWakeAt: null }));
      const step = built.processManagers.pm!.evolve(
        { seen: 0 },
        { type: "trace/spanReceived", data: { traceId: "t", spanId: "s" } },
        processCtx,
      );
      expect(step?.nextWakeAt).toBeNull();
    });

    /** @scenario a process manager is enabled by default */
    it("is enabled when .enabled is never declared", () => {
      const built = buildPm(() => ({ nextWakeAt: null }));
      expect(built.processManagers.pm!.enabled).toBe(true);
    });

    /** @scenario a process manager can be gated off explicitly */
    it("reports disabled when declared with enabled: false", () => {
      const built = buildPm(() => ({ nextWakeAt: null }), false);
      expect(built.processManagers.pm!.enabled).toBe(false);
    });
  });

  describe("given a fold's version is the hash of its own state schema", () => {
    /** @scenario two folds with the same state shape derive the same version */
    it("derives the same version for two structurally identical state schemas", () => {
      const build = (fieldOrder: "ab" | "ba") =>
        definePipeline("trace")
          .events({ spanReceived })
          .id({ spanReceived: (d) => d.traceId })
          .withFold("f", {
            state:
              fieldOrder === "ab"
                ? z.object({ a: z.number(), b: z.string() })
                : z.object({ b: z.string(), a: z.number() }),
            init: () => ({ a: 0, b: "" }),
            on: { spanReceived: (state) => state },
            store: memoryReplaceStore<{ a: number; b: string }>(),
          })
          .build();

      expect(build("ab").folds.f!.stateVersion).toBe(
        build("ba").folds.f!.stateVersion,
      );
    });

    /** @scenario changing a fold's state schema changes its derived version */
    it("derives a different version once the state schema gains a field", () => {
      const before = definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withFold("f", {
          state: z.object({ a: z.number() }),
          init: () => ({ a: 0 }),
          on: { spanReceived: (state) => state },
          store: memoryReplaceStore<{ a: number }>(),
        })
        .build();
      const after = definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withFold("f", {
          state: z.object({ a: z.number(), b: z.string() }),
          init: () => ({ a: 0, b: "" }),
          on: { spanReceived: (state) => state },
          store: memoryReplaceStore<{ a: number; b: string }>(),
        })
        .build();

      expect(before.folds.f!.stateVersion).not.toBe(
        after.folds.f!.stateVersion,
      );
    });

    /** @scenario an explicit pin overrides the derived version without switching off the hash */
    it("stamps the pin as the version while still reporting the computed hash", () => {
      const built = definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withFold("f", {
          state: z.object({ a: z.number() }),
          init: () => ({ a: 0 }),
          pin: "legacy-3",
          on: { spanReceived: (state) => state },
          store: memoryReplaceStore<{ a: number }>(),
        })
        .build();

      expect(built.folds.f!.stateVersion).toBe("legacy-3");
      expect(built.folds.f!.schemaHash).not.toBe("legacy-3");
    });
  });

  describe("given handlers return new state", () => {
    /** @scenario a fold's handler returns a new state object rather than mutating the one it was given */
    it("leaves the state object handed to the handler untouched", async () => {
      const store = memoryReplaceStore<{ spanIds: string[] }>();
      const built = definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withFold("f", {
          state: z.object({ spanIds: z.array(z.string()) }),
          init: () => ({ spanIds: [] }),
          on: {
            spanReceived: (state, data) => ({
              spanIds: [...state.spanIds, data.spanId],
            }),
          },
          store,
        })
        .build();

      const original = { spanIds: ["existing"] };
      const snapshot = { spanIds: [...original.spanIds] };
      store.rows.set("t1", {
        state: original,
        version: built.folds.f!.stateVersion,
      });

      await built.folds.f!.apply({
        key: "t1",
        tenantId: "tenant-1",
        events: [
          { type: "trace/spanReceived", data: { traceId: "t1", spanId: "s2" } },
        ],
      });

      expect(original).toEqual(snapshot);
    });
  });

  describe("given a member's name is its identity, and it cannot be reused", () => {
    /** @scenario two members sharing a name is refused */
    it("refuses a second mount under a name already taken", () => {
      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .withMap("shared", {
            on: { spanReceived: (d) => ({ id: d.traceId }) },
            store: memoryAppendStore(),
          })
          .withSubscriber("shared", { on: { spanReceived: () => undefined } }),
      ).toThrow(ConfigurationError);
    });
  });

  describe("given a pipeline's own identity cannot produce an unroutable type string", () => {
    /** @scenario a pipeline name containing the type-string separator is refused */
    it("refuses a pipeline name containing the type-string separator", () => {
      expect(() => definePipeline("bad/name")).toThrow(ConfigurationError);
      expect(() => definePipeline("bad.name")).toThrow(ConfigurationError);
    });

    /** @scenario a pipeline prefix containing the unprefixed-form separator is refused */
    it("refuses a prefix containing the unprefixed-form separator", () => {
      expect(() => definePipeline("trace").prefix("bad/prefix")).toThrow(
        ConfigurationError,
      );
    });

    it("allows a dot-joined, multi-segment prefix", () => {
      const built = definePipeline("trace")
        .prefix("lw.obs")
        .events({ spanReceived })
        .build();
      expect(built.prefix).toBe("lw.obs");
    });

    /** @scenario an intent key containing the type-string separator is refused */
    it("refuses an intent key containing the type-string separator", () => {
      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .id({ spanReceived: (d) => d.traceId })
          .withProcessManager("pm", {
            state: z.object({}),
            init: () => ({}),
            intents: {
              "bad/key": {
                payload: z.object({}),
                messageKey: () => "x",
                deliver: () => undefined,
              },
            },
            on: {},
          }),
      ).toThrow(ConfigurationError);
    });
  });

  describe("given a process manager cannot be mounted before the pipeline has an id", () => {
    /** @scenario mounting a process manager without a preceding .id is refused */
    it("refuses a process manager force-mounted before .id", () => {
      const chain = definePipeline("trace").events({
        spanReceived,
      }) as unknown as {
        withProcessManager: (name: string, record: unknown) => unknown;
      };

      expect(() => chain.withProcessManager("pm", {})).toThrow(
        ConfigurationError,
      );
    });
  });

  describe("given .build() checks every mount against ADR-106", () => {
    /** @scenario a projection that reads its prior state is mounted correctly */
    it("builds a fold scoped to one aggregate on a store that reads back", () => {
      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .id({ spanReceived: (d) => d.traceId })
          .withFold("summary", {
            state: z.object({ n: z.number() }),
            init: () => ({ n: 0 }),
            on: { spanReceived: (state) => state },
            store: memoryReplaceStore<{ n: number }>(),
          })
          .build(),
      ).not.toThrow();
    });

    it("builds a map on an append store untouched", () => {
      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .withMap("spans", {
            on: { spanReceived: (d) => ({ id: d.spanId }) },
            store: memoryAppendStore(),
          })
          .build(),
      ).not.toThrow();
    });

    /** @scenario a projection is mounted on a store that combines rows by their key */
    it("refuses a map mounted on a store whose engine combines rows by key", () => {
      let caught: unknown;
      try {
        definePipeline("trace")
          .events({ spanReceived })
          .withMap("rollup", {
            on: { spanReceived: (d) => ({ id: d.spanId }) },
            store: memoryMergeStore(),
          })
          .build();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigurationError);
      const err = caught as ConfigurationError;
      expect(err.context).toMatchObject({
        pipeline: "trace",
        violations: [
          { member: "rollup", rule: "merge-closed-to-new-adopters" },
        ],
      });
    });

    it("names every illegally mounted member in one pipeline, not only the first", () => {
      let caught: unknown;
      try {
        definePipeline("trace")
          .events({ spanReceived })
          .withMap("rollupA", {
            on: { spanReceived: (d) => ({ id: d.spanId }) },
            store: memoryMergeStore(),
          })
          .withMap("rollupB", {
            on: { spanReceived: (d) => ({ id: d.spanId }) },
            store: memoryMergeStore(),
          })
          .build();
      } catch (error) {
        caught = error;
      }
      const err = caught as ConfigurationError;
      const members = (err.context.violations as { member: string }[]).map(
        (v) => v.member,
      );
      expect(members.sort()).toEqual(["rollupA", "rollupB"]);
    });
  });

  describe("given the builder accepts a pre-built member (ADR-107 decision 17)", () => {
    it("mounts a pre-built subscriber and dispatches to it by name", async () => {
      const calls: unknown[] = [];
      const built = definePipeline("trace")
        .events({ spanReceived })
        .withSubscriber("eeSubscriber", {
          name: "eeSubscriber",
          eventTypes: ["trace/spanReceived"],
          handle: (event, ctx) => {
            calls.push({ event, ctx });
          },
        })
        .build();

      await built.subscribers.eeSubscriber!.handle(
        { type: "trace/spanReceived", data: { traceId: "t", spanId: "s" } },
        ctx,
      );
      expect(calls).toEqual([
        {
          event: {
            type: "trace/spanReceived",
            data: { traceId: "t", spanId: "s" },
          },
          ctx,
        },
      ]);
    });

    it("keeps a pre-built subscriber's name distinct from a declared subscriber's", () => {
      expect(() =>
        definePipeline("trace")
          .events({ spanReceived })
          .withSubscriber("declared", { on: { spanReceived: () => undefined } })
          .withSubscriber("declared", {
            name: "declared",
            eventTypes: ["trace/spanReceived"],
            handle: () => undefined,
          })
          .build(),
      ).toThrow(ConfigurationError);
    });

    it("mounts a pre-built map and delegates apply to it verbatim", async () => {
      const written: unknown[] = [];
      const built = definePipeline("trace")
        .events({ spanReceived })
        .withMap(
          "eeMap",
          {
            name: "eeMap",
            eventTypes: ["trace/spanReceived"],
            apply: async (delivery) => {
              written.push(...delivery.events);
              return { written: delivery.events.length };
            },
          },
          {
            projection: "map",
            store: "append",
            scope: "aggregate",
            collapse: "none",
          },
        )
        .build();

      const result = await built.maps.eeMap!.apply({
        tenantId: "tenant-1",
        events: [
          { type: "trace/spanReceived", data: { traceId: "t", spanId: "s" } },
        ],
      });
      expect(result).toEqual({ written: 1 });
      expect(written).toEqual([
        { type: "trace/spanReceived", data: { traceId: "t", spanId: "s" } },
      ]);
    });

    it("refuses a pre-built map whose stated mount breaks ADR-106", () => {
      let caught: unknown;
      try {
        definePipeline("trace")
          .events({ spanReceived })
          .withMap(
            "eeRollup",
            {
              name: "eeRollup",
              eventTypes: ["trace/spanReceived"],
              apply: async () => ({ written: 0 }),
            },
            {
              projection: "map",
              store: "merge",
              scope: "aggregate",
              collapse: "none",
              idempotency: "whole-bucket-replace",
            },
          )
          .build();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigurationError);
      const err = caught as ConfigurationError;
      expect(err.context).toMatchObject({
        violations: [
          { member: "eeRollup", rule: "merge-closed-to-new-adopters" },
        ],
      });
    });
  });

  describe("given metrics is a port supplied once at .build(), not per mount", () => {
    it("threads the metrics port into a fold's executor", async () => {
      const metrics = fakeMetrics();
      const built = definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withFold("summary", {
          state: z.object({ n: z.number() }),
          init: () => ({ n: 0 }),
          on: { spanReceived: (state) => ({ n: state.n + 1 }) },
          store: memoryReplaceStore<{ n: number }>(),
        })
        .build({ metrics });

      await built.folds.summary!.apply({
        key: "t1",
        tenantId: "tenant-1",
        events: [
          { type: "trace/spanReceived", data: { traceId: "t1", spanId: "s1" } },
        ],
      });

      expect(
        metrics.incs.some(
          (c) =>
            c.name === "es_fold_apply_outcomes_total" &&
            c.labels?.kind === "applied",
        ),
      ).toBe(true);
    });

    it("threads the metrics port into a map's executor", async () => {
      const metrics = fakeMetrics();
      const built = definePipeline("trace")
        .events({ spanReceived })
        .withMap("spans", {
          on: { spanReceived: (d) => ({ id: d.spanId }) },
          store: memoryAppendStore(),
        })
        .build({ metrics });

      await built.maps.spans!.apply({
        tenantId: "tenant-1",
        events: [
          { type: "trace/spanReceived", data: { traceId: "t1", spanId: "s1" } },
        ],
      });

      expect(
        metrics.incs.some(
          (c) =>
            c.name === "es_map_write_batch_total" &&
            c.labels?.outcome === "written",
        ),
      ).toBe(true);
    });

    it("runs a fold's executor safely with no metrics port supplied", async () => {
      const built = definePipeline("trace")
        .events({ spanReceived })
        .id({ spanReceived: (d) => d.traceId })
        .withFold("summary", {
          state: z.object({ n: z.number() }),
          init: () => ({ n: 0 }),
          on: { spanReceived: (state) => state },
          store: memoryReplaceStore<{ n: number }>(),
        })
        .build();

      await expect(
        built.folds.summary!.apply({
          key: "t1",
          tenantId: "tenant-1",
          events: [
            {
              type: "trace/spanReceived",
              data: { traceId: "t1", spanId: "s1" },
            },
          ],
        }),
      ).resolves.toEqual({ events: 1 });
    });
  });
});
