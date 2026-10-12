import { afterEach, describe, expect, it, vi } from "vitest";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
import { clickHouseConcurrencyMetrics } from "../metrics";
import {
  DEFAULT_TENANT_ANALYTICS_CONCURRENCY,
  getTenantAnalyticsConcurrency,
  TenantStatementLimiter,
} from "../tenantStatementLimit";

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

describe("TenantStatementLimiter", () => {
  describe("when one tenant's dashboard fires more panels than its limit", () => {
    /** @scenario A dashboard load runs a bounded number of panel queries at once */
    it("runs only the limit at once and starts the next as one finishes", async () => {
      const limiter = new TenantStatementLimiter({ maxConcurrent: 2 });
      const panels = Array.from({ length: 5 }, (_, i) => heldTask(i));
      const results = panels.map((panel) =>
        limiter.run({ tenantId: "acme", task: panel.task }),
      );
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
      const limiter = new TenantStatementLimiter({ maxConcurrent: 1 });
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
      const limiter = new TenantStatementLimiter({ maxConcurrent: 1 });
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
      const limiter = new TenantStatementLimiter({ maxConcurrent: 2 });
      await limiter.run({ tenantId: "acme", task: async () => 1 });

      expect(limiter.activeTenantCount()).toBe(0);
    });
  });

  describe("when a tenant's wait queue is full", () => {
    it("refuses the statement as a transient overload", async () => {
      const limiter = new TenantStatementLimiter({
        maxConcurrent: 1,
        maxQueued: 1,
      });
      const running = heldTask(1);
      const waiting = heldTask(2);
      void limiter.run({ tenantId: "acme", task: running.task });
      void limiter.run({ tenantId: "acme", task: waiting.task });

      await expect(
        limiter.run({ tenantId: "acme", task: async () => 3 }),
      ).rejects.toBeInstanceOf(ClickHouseOverloadedError);

      running.release();
      waiting.release();
    });
  });
});

describe("TenantStatementLimiter wait bound", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when a statement waits longer than the wait timeout", () => {
    /** @scenario A panel waiting too long for its tenant's turn fails as a transient overload */
    it("refuses it as a transient overload and never runs it", async () => {
      vi.useFakeTimers();
      const limiter = new TenantStatementLimiter({
        maxConcurrent: 1,
        waitTimeoutMs: 1_000,
      });
      const running = heldTask(1);
      void limiter.run({ tenantId: "acme", task: running.task });
      const waiting = heldTask(2);
      const result = limiter.run({ tenantId: "acme", task: waiting.task });
      const assertion = expect(result).rejects.toBeInstanceOf(
        ClickHouseOverloadedError,
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await assertion;
      expect(waiting.hasStarted()).toBe(false);
      expect(limiter.stats("acme")).toEqual({ inFlight: 1, queued: 0 });

      running.release();
    });
  });

  describe("when a statement is admitted before the wait timeout", () => {
    it("runs it to completion past the timeout", async () => {
      vi.useFakeTimers();
      const limiter = new TenantStatementLimiter({
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
      const limiter = new TenantStatementLimiter({ maxConcurrent: 1 });
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
      const instance = "tenant-analytics-test";
      const limiter = new TenantStatementLimiter({
        maxConcurrent: 1,
        maxQueued: 1,
        metricsInstance: instance,
      });
      const a1 = heldTask(1);
      const a2 = heldTask(2);
      const b1 = heldTask(3);
      void limiter.run({ tenantId: "acme", task: a1.task });
      void limiter.run({ tenantId: "acme", task: a2.task });
      void limiter.run({ tenantId: "globex", task: b1.task });
      await flush();

      const gauge = async (metric: {
        get: () => Promise<{
          values: Array<{ labels: Record<string, unknown>; value: number }>;
        }>;
      }) =>
        (await metric.get()).values.find((v) => v.labels.instance === instance)
          ?.value;
      expect(await gauge(clickHouseConcurrencyMetrics.inFlight)).toBe(2);
      expect(await gauge(clickHouseConcurrencyMetrics.queued)).toBe(1);

      await expect(
        limiter.run({ tenantId: "acme", task: async () => 4 }),
      ).rejects.toBeInstanceOf(ClickHouseOverloadedError);
      expect(await gauge(clickHouseConcurrencyMetrics.shed)).toBe(1);

      for (const task of [a1, a2, b1]) task.release();
    });
  });
});

describe("getTenantAnalyticsConcurrency", () => {
  describe("when the variable is unset or blank", () => {
    it("uses the default", () => {
      expect(getTenantAnalyticsConcurrency({})).toBe(
        DEFAULT_TENANT_ANALYTICS_CONCURRENCY,
      );
      expect(
        getTenantAnalyticsConcurrency({
          CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY: " ",
        }),
      ).toBe(DEFAULT_TENANT_ANALYTICS_CONCURRENCY);
    });
  });

  describe("when the variable is a positive integer", () => {
    it("uses it", () => {
      expect(
        getTenantAnalyticsConcurrency({
          CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY: "8",
        }),
      ).toBe(8);
    });
  });

  describe("when the variable is not a positive integer", () => {
    it("falls back to the default", () => {
      for (const raw of ["0", "-1", "2.5", "many"]) {
        expect(
          getTenantAnalyticsConcurrency({
            CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY: raw,
          }),
        ).toBe(DEFAULT_TENANT_ANALYTICS_CONCURRENCY);
      }
    });
  });
});
