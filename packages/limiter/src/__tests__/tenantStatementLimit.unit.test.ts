import { afterEach, describe, expect, it, vi } from "vitest";

import { InProcessTenantStatementLimiter } from "../tenantStatementLimit.ts";

class ClickHouseOverloadedError extends Error {}
const overloadErrorFactory = {
  create: ({ cause }: { cause: unknown }) => new ClickHouseOverloadedError("overloaded", { cause }),
};
/** The bounds analytics passes; a case overrides the one it exercises. */
const bounds = { maxQueued: 64, waitTimeoutMs: 45_000, metricsInstance: "tenant-analytics-test" };
/** A task that stays running until the test releases it. */
function heldTask<T>(value: T) {
  let release!: () => void;
  let started = false;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    task: async () => {
      started = true;
      await done;
      return value;
    },
    release: () => release(),
    hasStarted: () => started,
  };
}

/** Let queued microtasks (limiter hand-offs) run. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("InProcessTenantStatementLimiter", () => {
  describe("when one tenant's dashboard fires more panels than its limit", () => {
    /** @scenario A dashboard load runs a bounded number of panel queries at once */
    it("runs only the limit at once and starts the next as one finishes", async () => {
      const limiter = new InProcessTenantStatementLimiter({
        ...bounds,
        overloadErrorFactory,
        maxConcurrent: 2,
      });
      const panels = Array.from({ length: 5 }, (_, i) => heldTask(i));
      const results = panels.map((panel) => limiter.run({ tenantId: "acme", task: panel.task }));
      await flush();

      expect(panels.filter((p) => p.hasStarted())).toHaveLength(2);
      expect(limiter.stats("acme")).toEqual({ inFlight: 2, queued: 3 });

      panels[0]!.release();
      await flush();
      expect(panels.filter((p) => p.hasStarted())).toHaveLength(3);

      for (const panel of panels) panel.release();
      await expect(Promise.all(results)).resolves.toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe("when another tenant runs at the same time", () => {
    it("does not make it wait behind the first tenant's queue", async () => {
      const limiter = new InProcessTenantStatementLimiter({
        ...bounds,
        overloadErrorFactory,
        maxConcurrent: 1,
      });
      const acme = [heldTask("a1"), heldTask("a2")];
      for (const panel of acme) {
        void limiter.run({ tenantId: "acme", task: panel.task });
      }
      const other = heldTask("b1");
      const otherResult = limiter.run({ tenantId: "globex", task: other.task });
      await flush();

      expect(other.hasStarted()).toBe(true);
      expect(acme[1]!.hasStarted()).toBe(false);

      other.release();
      for (const panel of acme) panel.release();
      await expect(otherResult).resolves.toBe("b1");
    });
  });

  describe("when a statement fails", () => {
    it("frees its slot for the next statement and rethrows the failure", async () => {
      const limiter = new InProcessTenantStatementLimiter({
        ...bounds,
        overloadErrorFactory,
        maxConcurrent: 1,
      });
      const failure = new Error("Query memory limit exceeded");
      const failing = limiter.run({
        tenantId: "acme",
        task: async () => {
          throw failure;
        },
      });
      const next = limiter.run({ tenantId: "acme", task: async () => "next" });

      await expect(failing).rejects.toBe(failure);
      await expect(next).resolves.toBe("next");
    });
  });

  describe("when a tenant has nothing left running or waiting", () => {
    it("forgets the tenant", async () => {
      const limiter = new InProcessTenantStatementLimiter({
        ...bounds,
        overloadErrorFactory,
        maxConcurrent: 2,
      });
      await limiter.run({ tenantId: "acme", task: async () => 1 });

      expect(limiter.activeTenantCount()).toBe(0);
    });
  });

  describe("when a tenant's wait queue is full", () => {
    it("refuses the statement as a transient overload", async () => {
      const limiter = new InProcessTenantStatementLimiter({
        ...bounds,
        overloadErrorFactory,
        maxConcurrent: 1,
        maxQueued: 1,
      });
      const running = heldTask(1);
      const waiting = heldTask(2);
      void limiter.run({ tenantId: "acme", task: running.task });
      void limiter.run({ tenantId: "acme", task: waiting.task });

      await expect(limiter.run({ tenantId: "acme", task: async () => 3 })).rejects.toBeInstanceOf(
        ClickHouseOverloadedError,
      );

      running.release();
      waiting.release();
    });
  });
});

describe("InProcessTenantStatementLimiter wait bound", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when a statement waits longer than the wait timeout", () => {
    /** @scenario A panel waiting too long for its tenant's turn fails as a transient overload */
    it("refuses it as a transient overload and never runs it", async () => {
      vi.useFakeTimers();
      const limiter = new InProcessTenantStatementLimiter({
        ...bounds,
        overloadErrorFactory,
        maxConcurrent: 1,
        waitTimeoutMs: 1_000,
      });
      const running = heldTask(1);
      void limiter.run({ tenantId: "acme", task: running.task });
      const waiting = heldTask(2);
      const result = limiter.run({ tenantId: "acme", task: waiting.task });
      await Promise.all([
        expect(result).rejects.toBeInstanceOf(ClickHouseOverloadedError),
        vi.advanceTimersByTimeAsync(1_000),
      ]);
      expect(waiting.hasStarted()).toBe(false);
      expect(limiter.stats("acme")).toEqual({ inFlight: 1, queued: 0 });

      running.release();
    });
  });

  describe("when a statement is admitted before the wait timeout", () => {
    it("runs it to completion past the timeout", async () => {
      vi.useFakeTimers();
      const limiter = new InProcessTenantStatementLimiter({
        ...bounds,
        overloadErrorFactory,
        maxConcurrent: 1,
        waitTimeoutMs: 1_000,
      });
      const running = heldTask(1);
      void limiter.run({ tenantId: "acme", task: running.task });
      const waiting = heldTask(2);
      const result = limiter.run({ tenantId: "acme", task: waiting.task });

      running.release();
      await flush();
      expect(waiting.hasStarted()).toBe(true);
      await vi.advanceTimersByTimeAsync(5_000);
      waiting.release();
      await expect(result).resolves.toBe(2);
    });
  });

  describe("when the caller aborts while waiting", () => {
    it("gives up the turn as a cancellation, not an overload", async () => {
      const limiter = new InProcessTenantStatementLimiter({
        ...bounds,
        overloadErrorFactory,
        maxConcurrent: 1,
      });
      const running = heldTask(1);
      void limiter.run({ tenantId: "acme", task: running.task });
      const controller = new AbortController();
      const waiting = heldTask(2);
      const result = limiter.run({
        tenantId: "acme",
        task: waiting.task,
        signal: controller.signal,
      });

      controller.abort();
      const error = await result.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ClickHouseOverloadedError);
      expect(waiting.hasStarted()).toBe(false);

      running.release();
    });
  });

  describe("when metrics are enabled", () => {
    it("publishes in-flight and queued counts across tenants and counts refusals", async () => {
      const sheds: string[] = [];
      let totals: () => { inFlight: number; queued: number } = () => ({ inFlight: 0, queued: 0 });
      const limiter = new InProcessTenantStatementLimiter({
        ...bounds,
        overloadErrorFactory,
        maxConcurrent: 1,
        maxQueued: 1,
        metricsInstance: "tenant-analytics-test",
        telemetry: {
          registerLimiter: ({ stats }) => {
            totals = stats;
          },
          unregisterLimiter: () => undefined,
          observeStatementWait: () => undefined,
          incrementStatementsShed: ({ instance }) => sheds.push(instance),
        },
      });
      const a1 = heldTask(1);
      const a2 = heldTask(2);
      const b1 = heldTask(3);
      void limiter.run({ tenantId: "acme", task: a1.task });
      void limiter.run({ tenantId: "acme", task: a2.task });
      void limiter.run({ tenantId: "globex", task: b1.task });
      await flush();

      expect(totals()).toEqual({ inFlight: 2, queued: 1 });
      await expect(limiter.run({ tenantId: "acme", task: async () => 4 })).rejects.toBeInstanceOf(
        ClickHouseOverloadedError,
      );
      expect(sheds).toEqual(["tenant-analytics-test"]);

      for (const task of [a1, a2, b1]) task.release();
    });
  });
});
