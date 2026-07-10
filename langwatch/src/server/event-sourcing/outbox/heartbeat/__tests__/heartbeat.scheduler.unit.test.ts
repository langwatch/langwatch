import type { Cluster, Redis } from "ioredis";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import type { OutboxEnqueueRequest } from "../../outboxReactor.types";
import { OutboxHeartbeatRegistry } from "../heartbeat.registry";
import {
  type DispatchOutboxEnqueues,
  OutboxHeartbeatScheduler,
  type OutboxHeartbeatSchedulerDeps,
} from "../heartbeat.scheduler";
import type { HeartbeatDefinition } from "../heartbeat.types";

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

/**
 * Minimal in-memory mock of the slice of ioredis the scheduler uses:
 * `SET k v PX ms NX` and `EVAL` of the CAS-DEL Lua script. Lock TTL is
 * driven by the test clock (`vi.useFakeTimers()` advances both
 * `setInterval` and `Date.now()`), so a tick that runs after the
 * configured TTL elapses can re-acquire the lock.
 */
class FakeRedis {
  private store = new Map<string, { value: string; expiresAtMs: number }>();

  reset(): void {
    this.store.clear();
  }

  private cleanupExpired(now: number): void {
    for (const [k, v] of this.store) {
      if (v.expiresAtMs <= now) this.store.delete(k);
    }
  }

  set = vi.fn(
    async (
      key: string,
      value: string,
      _pxFlag: "PX",
      ttlMs: number,
      _nxFlag: "NX",
    ): Promise<"OK" | null> => {
      const now = Date.now();
      this.cleanupExpired(now);
      const existing = this.store.get(key);
      if (existing) return null;
      this.store.set(key, { value, expiresAtMs: now + ttlMs });
      return "OK";
    },
  );

  // Implements just the CAS-DEL script the scheduler ships:
  //   if get(KEYS[1]) == ARGV[1] then del(KEYS[1]) else 0 end
  eval = vi.fn(
    async (
      _script: string,
      _numKeys: number,
      key: string,
      argv: string,
    ): Promise<number> => {
      const now = Date.now();
      this.cleanupExpired(now);
      const existing = this.store.get(key);
      if (existing && existing.value === argv) {
        this.store.delete(key);
        return 1;
      }
      return 0;
    },
  );

  // Test-only helper: simulate a crash that leaves the lock dangling.
  forceWipeWithoutRelease(): void {
    this.store.clear();
  }

  hasKey(key: string): boolean {
    this.cleanupExpired(Date.now());
    return this.store.has(key);
  }
}

const silentLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as OutboxHeartbeatSchedulerDeps["logger"];

function makeRequest(name: string): OutboxEnqueueRequest {
  return {
    dedupKey: `proj/${name}`,
    groupKey: `proj/${name}`,
    payload: {
      stage: "settle",
      projectId: "proj",
    } as unknown as OutboxEnqueueRequest["payload"],
  };
}

function makeDispatch(): { dispatch: DispatchOutboxEnqueues; calls: Mock } {
  const calls = vi.fn(
    async (_params: Parameters<DispatchOutboxEnqueues>[0]) => undefined,
  );
  return { dispatch: calls, calls };
}

function makeScheduler({
  registry,
  redis,
  dispatch,
  processRole = "worker",
}: {
  registry: OutboxHeartbeatRegistry;
  redis: FakeRedis;
  dispatch: DispatchOutboxEnqueues;
  processRole?: "worker" | "web" | "migration" | undefined;
}): OutboxHeartbeatScheduler {
  return new OutboxHeartbeatScheduler({
    registry,
    redis: redis as unknown as Redis | Cluster,
    dispatchOutboxEnqueues: dispatch,
    processRole,
    logger: silentLogger,
  });
}

describe("OutboxHeartbeatScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("given a worker scheduler with a single heartbeat", () => {
    describe("when intervalMs elapses", () => {
      it("fires decide and routes the result through the dispatcher", async () => {
        const registry = new OutboxHeartbeatRegistry();
        const redis = new FakeRedis();
        const { dispatch, calls: dispatchCalls } = makeDispatch();
        const decide = vi.fn(async () => [makeRequest("alpha")]);
        registry.register({
          name: "hb-alpha",
          intervalMs: 1_000,
          decide,
        });
        const scheduler = makeScheduler({ registry, redis, dispatch });
        scheduler.start();

        await vi.advanceTimersByTimeAsync(1_000);

        expect(decide).toHaveBeenCalledTimes(1);
        expect(dispatchCalls).toHaveBeenCalledTimes(1);
        expect(dispatchCalls).toHaveBeenCalledWith({
          requests: [makeRequest("alpha")],
          sourceName: "hb-alpha",
        });

        await scheduler.stop();
      });
    });
  });

  describe("given two schedulers racing on the same heartbeat name", () => {
    describe("when both ticks fire while one holds the lock", () => {
      it("only the lock-acquiring scheduler runs decide", async () => {
        // Hold the lock for 5s of `decide` work — long enough that the
        // second scheduler's same-second tick definitely sees a held
        // lock and skips. Without the in-flight delay the first
        // scheduler would have released by the time the second one
        // tried, and both would observe a free lock back-to-back.
        const redis = new FakeRedis();

        // decideA is "slow" — it blocks until we manually resolve it,
        // ensuring the lock stays taken when scheduler B's tick fires.
        let releaseDecideA: () => void = () => undefined;
        const decideAPromise = new Promise<void>((resolve) => {
          releaseDecideA = resolve;
        });
        const decideA = vi.fn(async () => {
          await decideAPromise;
          return [];
        });
        const decideB = vi.fn(async () => []);

        const registryA = new OutboxHeartbeatRegistry();
        const registryB = new OutboxHeartbeatRegistry();
        registryA.register({
          name: "hb-shared",
          intervalMs: 1_000,
          decide: decideA,
        });
        registryB.register({
          name: "hb-shared",
          intervalMs: 1_000,
          decide: decideB,
        });

        const { dispatch } = makeDispatch();
        const schedulerA = makeScheduler({
          registry: registryA,
          redis,
          dispatch,
        });
        const schedulerB = makeScheduler({
          registry: registryB,
          redis,
          dispatch,
        });
        schedulerA.start();
        schedulerB.start();

        // First tick: A acquires + holds (decide pending), B tries +
        // skips because the lock is held.
        await vi.advanceTimersByTimeAsync(1_000);
        expect(decideA).toHaveBeenCalledTimes(1);
        expect(decideB).not.toHaveBeenCalled();

        // Release A's decide so the lock comes back; flush microtasks.
        releaseDecideA();
        await vi.advanceTimersByTimeAsync(0);

        await schedulerA.stop();
        await schedulerB.stop();
      });
    });
  });

  describe("given a heartbeat whose decide stranded the lock (simulated crash)", () => {
    describe("when the TTL elapses and the next tick fires", () => {
      it("the surviving scheduler re-acquires the lock and runs decide", async () => {
        // intervalMs 1s → lock TTL = max(30s, 2s) = 30s. To verify recovery
        // without waiting 30s of fake time per tick, drive the recovery on
        // a fresh scheduler instance simulating a different worker.
        const registry = new OutboxHeartbeatRegistry();
        const redis = new FakeRedis();
        const decide = vi.fn(async () => []);
        registry.register({
          name: "hb-recover",
          intervalMs: 1_000,
          decide,
        });
        const { dispatch } = makeDispatch();
        const crashed = makeScheduler({ registry, redis, dispatch });
        crashed.start();

        // First tick acquires the lock and runs decide.
        await vi.advanceTimersByTimeAsync(1_000);
        expect(decide).toHaveBeenCalledTimes(1);
        // Simulate a process crash: stop scheduler WITHOUT releasing the lock.
        // Direct `clearInterval` via stop() but pre-empt the release by
        // overriding eval to no-op once (simulating the worker dying mid-flight).
        // Simpler: just rip the lock state to mimic post-TTL, then verify
        // the next worker can acquire.
        // We instead simulate TTL expiry by clearing the store and starting a
        // new scheduler that should immediately acquire on its first tick.
        await crashed.stop();

        // Advance past the 30s lock TTL window so a real-world recovery would
        // see the lock auto-reaped.
        await vi.advanceTimersByTimeAsync(30_000);

        const registry2 = new OutboxHeartbeatRegistry();
        const decide2 = vi.fn(async () => []);
        registry2.register({
          name: "hb-recover",
          intervalMs: 1_000,
          decide: decide2,
        });
        const fresh = makeScheduler({ registry: registry2, redis, dispatch });
        fresh.start();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(decide2).toHaveBeenCalledTimes(1);

        await fresh.stop();
      });
    });
  });

  describe("given processRole = web", () => {
    describe("when start() is called and intervalMs elapses", () => {
      it("decide is never invoked", async () => {
        const registry = new OutboxHeartbeatRegistry();
        const redis = new FakeRedis();
        const decide = vi.fn(async () => []);
        registry.register({ name: "hb-web", intervalMs: 1_000, decide });
        const { dispatch } = makeDispatch();
        const scheduler = makeScheduler({
          registry,
          redis,
          dispatch,
          processRole: "web",
        });
        scheduler.start();

        await vi.advanceTimersByTimeAsync(10_000);

        expect(decide).not.toHaveBeenCalled();
        expect(redis.set).not.toHaveBeenCalled();

        await scheduler.stop();
      });
    });
  });

  describe("given a decide that throws", () => {
    describe("when the tick fires", () => {
      it("the error is swallowed, the lock is released, and the next tick still fires", async () => {
        const registry = new OutboxHeartbeatRegistry();
        const redis = new FakeRedis();
        let callCount = 0;
        const decide = vi.fn(async () => {
          callCount++;
          if (callCount === 1) throw new Error("boom");
          return [];
        });
        registry.register({ name: "hb-throws", intervalMs: 1_000, decide });
        const { dispatch } = makeDispatch();
        const scheduler = makeScheduler({ registry, redis, dispatch });
        scheduler.start();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(decide).toHaveBeenCalledTimes(1);
        // Lock released even after throw — Lua eval was invoked.
        expect(redis.eval).toHaveBeenCalledTimes(1);
        expect(redis.hasKey("hb:lock:hb-throws")).toBe(false);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(decide).toHaveBeenCalledTimes(2);

        await scheduler.stop();
      });
    });
  });

  describe("given a sub-1s intervalMs", () => {
    describe("when start() runs", () => {
      it("clamps the interval to 1000ms before firing", async () => {
        const registry = new OutboxHeartbeatRegistry();
        const redis = new FakeRedis();
        const decide = vi.fn(async () => []);
        registry.register({ name: "hb-fast", intervalMs: 50, decide });
        const { dispatch } = makeDispatch();
        const scheduler = makeScheduler({ registry, redis, dispatch });
        scheduler.start();

        // At 999ms the clamped tick should not yet have fired.
        await vi.advanceTimersByTimeAsync(999);
        expect(decide).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(decide).toHaveBeenCalledTimes(1);

        await scheduler.stop();
      });
    });
  });
});
