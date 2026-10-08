import { describe, expect, it } from "vitest";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
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
