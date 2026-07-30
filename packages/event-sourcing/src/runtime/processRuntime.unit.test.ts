import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { definePipeline } from "../pipeline/definePipeline";
import type { EvolveStep } from "../pipeline/pipeline.types";
import type { ProcessInstanceKey } from "./contracts";
import {
  memoryClock,
  memoryOutbox,
  memoryProcessStore,
  RevisionConflictError,
} from "./memory";
import { createProcessRuntime } from "./processRuntime";

/**
 * The process runtime is the one place a process manager's read-evolve-write
 * cycle happens (ADR-108 decision 11). These tests are about the decisions
 * that cycle makes: genesis vs. found vs. undecodable, a stale revision
 * losing the race, a batch producing one save and one outbox emission rather
 * than one per event, and the three distinct meanings of nextWakeAt.
 */

// `untouched` never gets a handler declared — it exists so "an event with no
// declared handler" has something to deliver without leaving a process
// manager with zero handlers at all, which the mount checker refuses.
const events = { tick: z.object({ n: z.number() }), untouched: z.object({}) };

interface CounterState {
  readonly count: number;
}

type CounterIntents = {
  readonly notify: {
    readonly payload: z.ZodObject<{ count: z.ZodNumber }>;
    readonly messageKey: (p: { count: number }) => string;
    readonly deliver: (p: { count: number }) => void | Promise<void>;
  };
};

const defaultOnTick = (
  state: CounterState,
): EvolveStep<CounterState, CounterIntents> => ({
  state,
  intents: [],
  nextWakeAt: null,
});

function buildManager(opts: {
  readonly on?: (
    state: CounterState,
    data: { n: number },
  ) => EvolveStep<CounterState, CounterIntents>;
  readonly onWake?: (
    state: CounterState,
  ) => EvolveStep<CounterState, CounterIntents>;
  readonly deliver?: (payload: { count: number }) => void | Promise<void>;
  readonly messageKey?: (payload: { count: number }) => string;
  readonly pin?: string;
}) {
  const built = definePipeline("counter")
    .events(events)
    .id({ tick: (d) => `k${d.n}`, untouched: () => "k" })
    .withProcessManager("counter", {
      state: z.object({ count: z.number() }),
      pin: opts.pin,
      init: () => ({ count: 0 }),
      intents: {
        notify: {
          payload: z.object({ count: z.number() }),
          messageKey: opts.messageKey ?? ((p) => `notify:${p.count}`),
          deliver: opts.deliver ?? (() => undefined),
        },
      },
      on: { tick: opts.on ?? defaultOnTick },
      onWake: opts.onWake,
    })
    .build();
  return built.processManagers.counter!;
}

const KEY: ProcessInstanceKey = {
  processName: "counter",
  projectId: "proj-1",
  processKey: "k1",
};

function harness(startAt = 1000) {
  const clock = memoryClock(startAt);
  const processStore = memoryProcessStore();
  const outbox = memoryOutbox(clock);
  const runtime = createProcessRuntime({ processStore, outbox, clock });
  return { clock, processStore, outbox, runtime };
}

describe("process runtime", () => {
  describe("given no row has ever been stored for this process instance", () => {
    /** @scenario The first delivery for an instance starts from genesis */
    it("starts the process from init() and saves at revision 1", async () => {
      const { processStore, runtime } = harness();
      const manager = buildManager({
        on: (state, data) => ({
          state: { count: state.count + data.n },
          intents: [],
          nextWakeAt: null,
        }),
      });

      await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/tick", data: { n: 5 } }],
      });

      const stored = await processStore.load(KEY);
      expect(stored).toMatchObject({
        state: { count: 5 },
        revision: 1,
        stateVersion: manager.stateVersion,
      });
    });
  });

  describe("given a process instance with an existing stored state", () => {
    /** @scenario A later delivery evolves the stored state, not a fresh one */
    it("evolves the stored state rather than starting from init() again", async () => {
      const { processStore, runtime } = harness();
      const manager = buildManager({
        on: (state, data) => ({
          state: { count: state.count + data.n },
          intents: [],
          nextWakeAt: null,
        }),
      });

      await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/tick", data: { n: 5 } }],
      });
      await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/tick", data: { n: 2 } }],
      });

      const stored = await processStore.load(KEY);
      expect(stored?.state).toEqual({ count: 7 });
      expect(stored?.revision).toBe(2);
    });
  });

  describe("given a stored row whose version does not match what this build expects", () => {
    /** @scenario A stored row this build cannot decode is never treated as genesis */
    it("fails the delivery rather than starting over from init()", async () => {
      const { processStore, runtime } = harness();
      const manager = buildManager({
        on: (state, data) => ({
          state: { count: state.count + data.n },
          intents: [],
          nextWakeAt: null,
        }),
      });
      await processStore.save({
        key: KEY,
        tenantId: "tenant-1",
        state: { count: 99 },
        stateVersion: "some-other-version",
        expectedRevision: 0,
        nextWakeAt: null,
      });

      await expect(
        runtime.deliver(manager, {
          key: KEY,
          tenantId: "tenant-1",
          events: [{ type: "counter/tick", data: { n: 1 } }],
        }),
      ).rejects.toThrow();

      const stored = await processStore.load(KEY);
      expect(stored?.state).toEqual({ count: 99 });
      expect(stored?.revision).toBe(1);
    });
  });

  describe("given a process instance loaded at revision 1", () => {
    /** @scenario A concurrent advance loses the race rather than the update */
    it("fails a save whose expected revision no longer matches", async () => {
      const { processStore, outbox, clock } = harness();
      const manager = buildManager({
        on: (state, data) => ({
          state: { count: state.count + data.n },
          intents: [],
          nextWakeAt: null,
        }),
      });
      const runtimeA = createProcessRuntime({ processStore, outbox, clock });
      const runtimeB = createProcessRuntime({ processStore, outbox, clock });

      // Both fire from the same absent starting point without awaiting one
      // before the other, so both load before either has saved — the race
      // an expected-revision check exists to resolve.
      const [resultA, resultB] = await Promise.allSettled([
        runtimeA.deliver(manager, {
          key: KEY,
          tenantId: "tenant-1",
          events: [{ type: "counter/tick", data: { n: 1 } }],
        }),
        runtimeB.deliver(manager, {
          key: KEY,
          tenantId: "tenant-1",
          events: [{ type: "counter/tick", data: { n: 100 } }],
        }),
      ]);

      const statuses = [resultA.status, resultB.status];
      expect(statuses.filter((s) => s === "fulfilled")).toHaveLength(1);
      expect(statuses.filter((s) => s === "rejected")).toHaveLength(1);
      const rejected =
        resultA.status === "rejected"
          ? resultA
          : (resultB as PromiseRejectedResult);
      expect(rejected.reason).toBeInstanceOf(RevisionConflictError);
    });
  });

  describe("given a process manager with no handler declared for a given event type", () => {
    /** @scenario An unhandled event leaves state, intents and the armed deadline untouched */
    it("runs no step, saves nothing and stages nothing", async () => {
      const { processStore, outbox, runtime } = harness();
      const manager = buildManager({});

      const outcome = await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/untouched", data: {} }],
      });

      expect(outcome).toEqual({ applied: 0 });
      expect(await processStore.load(KEY)).toBeNull();
      expect(outbox.rows).toEqual([]);
    });
  });

  describe("given a process manager whose handler advances state on each event it handles", () => {
    /** @scenario Several events in one delivery advance state through one save */
    it("advances state through every event but saves exactly once", async () => {
      const { processStore, runtime } = harness();
      const saveSpy = vi.spyOn(processStore, "save");
      const manager = buildManager({
        on: (state, data) => ({
          state: { count: state.count + data.n },
          intents: [],
          nextWakeAt: null,
        }),
      });

      const outcome = await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [
          { type: "counter/tick", data: { n: 1 } },
          { type: "counter/tick", data: { n: 2 } },
          { type: "counter/tick", data: { n: 3 } },
        ],
      });

      expect(outcome).toEqual({ applied: 3 });
      expect((await processStore.load(KEY))?.state).toEqual({ count: 6 });
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a process manager whose handler emits an intent on each event it handles", () => {
    /** @scenario Intents from a batch are staged in a single outbox call */
    it("stages every intent minted across the batch in one outbox call", async () => {
      const { outbox, runtime } = harness();
      const stageSpy = vi.spyOn(outbox, "stage");
      const manager = buildManager({
        on: (state, data) => ({
          state: { count: state.count + data.n },
          intents: [
            { type: "notify", payload: { count: state.count + data.n } },
          ],
          nextWakeAt: null,
        }),
      });

      await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [
          { type: "counter/tick", data: { n: 1 } },
          { type: "counter/tick", data: { n: 2 } },
        ],
      });

      expect(stageSpy).toHaveBeenCalledTimes(1);
      expect(outbox.rows).toHaveLength(2);
      expect(outbox.rows.map((row) => row.intentType)).toEqual([
        "counter/notify",
        "counter/notify",
      ]);
    });
  });

  describe("given a process instance with an armed wake deadline", () => {
    /** @scenario Returning null clears a previously armed deadline */
    it("clears the deadline when the step returns null", async () => {
      const { processStore, runtime } = harness();
      const manager = buildManager({
        on: () => ({ state: { count: 1 }, intents: [], nextWakeAt: null }),
      });
      await processStore.save({
        key: KEY,
        tenantId: "tenant-1",
        state: { count: 0 },
        stateVersion: manager.stateVersion,
        expectedRevision: 0,
        nextWakeAt: 5000,
      });

      await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/tick", data: { n: 1 } }],
      });

      expect((await processStore.load(KEY))?.nextWakeAt).toBeNull();
    });

    /** @scenario Returning a new number replaces the armed deadline */
    it("replaces the deadline when the step returns a new number", async () => {
      const { processStore, runtime } = harness();
      const manager = buildManager({
        on: () => ({ state: { count: 1 }, intents: [], nextWakeAt: 9000 }),
      });
      await processStore.save({
        key: KEY,
        tenantId: "tenant-1",
        state: { count: 0 },
        stateVersion: manager.stateVersion,
        expectedRevision: 0,
        nextWakeAt: 5000,
      });

      await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/tick", data: { n: 1 } }],
      });

      expect((await processStore.load(KEY))?.nextWakeAt).toBe(9000);
    });

    /** @scenario Returning the same number leaves the armed deadline as it was */
    it("leaves the deadline unchanged when the step returns the same number", async () => {
      const { processStore, runtime } = harness();
      const manager = buildManager({
        on: () => ({ state: { count: 1 }, intents: [], nextWakeAt: 5000 }),
      });
      await processStore.save({
        key: KEY,
        tenantId: "tenant-1",
        state: { count: 0 },
        stateVersion: manager.stateVersion,
        expectedRevision: 0,
        nextWakeAt: 5000,
      });

      await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/tick", data: { n: 1 } }],
      });

      expect((await processStore.load(KEY))?.nextWakeAt).toBe(5000);
    });
  });

  describe("given a process whose onWake computes its next deadline from the one that just came due", () => {
    /** @scenario A wake computed while running late is scheduled from now, not from the stale instant */
    it("clamps a wake's next deadline forward to the current time rather than the past", async () => {
      const { processStore, clock, runtime } = harness(10_000);
      const manager = buildManager({
        // A schedule computed off the deadline that just fired: due at 10_000,
        // interval 100 — the naive next deadline is 10_100.
        onWake: (state) => ({ state, intents: [], nextWakeAt: 10_100 }),
      });
      await processStore.save({
        key: KEY,
        tenantId: "tenant-1",
        state: { count: 0 },
        stateVersion: manager.stateVersion,
        expectedRevision: 0,
        nextWakeAt: 10_000,
      });
      // The consumer only gets to it long after 10_100 has also passed.
      clock.set(50_000);

      await runtime.wake(manager, { key: KEY, tenantId: "tenant-1" });

      expect((await processStore.load(KEY))?.nextWakeAt).toBe(50_000);
    });
  });

  describe("given a process whose onWake emits an intent keyed by the deadline it was woken for", () => {
    /** @scenario Two wake attempts for the same due deadline stage one row, not two */
    it("collapses a retried wake onto a single outbox row", async () => {
      const { processStore, outbox, runtime } = harness(10_000);
      const manager = buildManager({
        onWake: (state) => ({
          state,
          intents: [{ type: "notify", payload: { count: 10_000 } }],
          nextWakeAt: null,
        }),
        messageKey: (p) => `wake:${p.count}`,
      });
      await processStore.save({
        key: KEY,
        tenantId: "tenant-1",
        state: { count: 0 },
        stateVersion: manager.stateVersion,
        expectedRevision: 0,
        nextWakeAt: 10_000,
      });

      await runtime.wake(manager, { key: KEY, tenantId: "tenant-1" });
      // A retry of the same wake — the intent's payload is hardcoded to the
      // scheduled instant, not read from the clock, so a second wake mints
      // the same messageKey regardless of when it actually runs.
      await runtime.wake(manager, { key: KEY, tenantId: "tenant-1" });

      expect(outbox.rows).toHaveLength(1);
    });
  });

  describe("given a maintenance process that has never been armed", () => {
    /** @scenario A schedule with no deadline yet is armed by a worker boot */
    it("is given a deadline one interval away and its own genesis state", async () => {
      const { processStore, runtime } = harness(1000);
      const manager = buildManager({});

      const outcome = await runtime.ensureArmed(manager, {
        key: KEY,
        tenantId: "tenant-1",
        initialWakeAt: 1000 + 86_400_000,
      });

      expect(outcome).toEqual({ armed: true });
      expect(await processStore.load(KEY)).toMatchObject({
        state: { count: 0 },
        revision: 1,
        stateVersion: manager.stateVersion,
        nextWakeAt: 1000 + 86_400_000,
      });
    });
  });

  describe("given a maintenance process that was armed by an earlier boot", () => {
    /** @scenario A schedule that already holds a deadline is left alone by a later boot */
    it("does not touch the existing deadline or save again", async () => {
      const { processStore, runtime } = harness(1000);
      const manager = buildManager({});
      await processStore.save({
        key: KEY,
        tenantId: "tenant-1",
        state: { count: 0 },
        stateVersion: manager.stateVersion,
        expectedRevision: 0,
        nextWakeAt: 5000,
      });
      const saveSpy = vi.spyOn(processStore, "save");

      const outcome = await runtime.ensureArmed(manager, {
        key: KEY,
        tenantId: "tenant-1",
        initialWakeAt: 999_999,
      });

      expect(outcome).toEqual({ armed: false });
      expect(saveSpy).not.toHaveBeenCalled();
      expect((await processStore.load(KEY))?.nextWakeAt).toBe(5000);
    });
  });

  describe("given a process store that fails while arming a schedule", () => {
    /** @scenario A schedule that cannot be armed reports the failure rather than corrupting state */
    it("propagates the failure without leaving a partial row", async () => {
      const { processStore, runtime } = harness(1000);
      const manager = buildManager({});
      vi.spyOn(processStore, "save").mockRejectedValueOnce(
        new Error("store unavailable"),
      );

      await expect(
        runtime.ensureArmed(manager, {
          key: KEY,
          tenantId: "tenant-1",
          initialWakeAt: 2000,
        }),
      ).rejects.toThrow("store unavailable");
      expect(await processStore.load(KEY)).toBeNull();
    });
  });

  describe("given an event has caused a process manager to stage a chargeable intent", () => {
    /** @scenario Work scheduled for later survives a restart */
    it("keeps a wake deadline durable across a fresh runtime instance", async () => {
      const { processStore, outbox, clock } = harness(1000);
      const manager = buildManager({
        on: (state) => ({ state, intents: [], nextWakeAt: 2000 }),
        onWake: (state) => ({ state, intents: [], nextWakeAt: null }),
      });
      const runtimeBeforeRestart = createProcessRuntime({
        processStore,
        outbox,
        clock,
      });
      await runtimeBeforeRestart.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/tick", data: { n: 1 } }],
      });

      // "Every process is restarted": a brand new runtime, same durable store.
      clock.set(2500);
      const runtimeAfterRestart = createProcessRuntime({
        processStore,
        outbox,
        clock,
      });
      const due = await processStore.due(clock.now(), 10);
      // `due` carries the tenant and the deadline, so a woken instance builds
      // its own context without a second lookup.
      expect(due).toContainEqual({
        ...KEY,
        tenantId: "tenant-1",
        nextWakeAt: 2000,
      });

      await runtimeAfterRestart.wake(manager, {
        key: KEY,
        tenantId: "tenant-1",
      });
      expect((await processStore.load(KEY))?.nextWakeAt).toBeNull();
    });
  });

  describe("given a process manager whose step reads a fact derived from another stream", () => {
    /** @scenario A step that cannot yet read a fact it needs is retried, not treated as done */
    it("leaves state and intents untouched when the step throws", async () => {
      const { processStore, outbox, runtime } = harness();
      const manager = buildManager({
        on: () => {
          throw new Error("the other stream has not derived this fact yet");
        },
      });

      await expect(
        runtime.deliver(manager, {
          key: KEY,
          tenantId: "tenant-1",
          events: [{ type: "counter/tick", data: { n: 1 } }],
        }),
      ).rejects.toThrow();

      expect(await processStore.load(KEY)).toBeNull();
      expect(outbox.rows).toEqual([]);
    });
  });

  describe("given a process manager whose handler emits the same messageKey across two separate deliveries", () => {
    /** @scenario Two evolutions of the same logical intent stage one outbox row, not two */
    it("stages exactly one row for the message key, not one per delivery", async () => {
      const { outbox, runtime } = harness();
      const manager = buildManager({
        on: () => ({
          state: { count: 1 },
          intents: [{ type: "notify", payload: { count: 42 } }],
          nextWakeAt: null,
        }),
      });

      await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/tick", data: { n: 1 } }],
      });
      await runtime.deliver(manager, {
        key: KEY,
        tenantId: "tenant-1",
        events: [{ type: "counter/tick", data: { n: 1 } }],
      });

      expect(outbox.rows).toHaveLength(1);
    });
  });
});
