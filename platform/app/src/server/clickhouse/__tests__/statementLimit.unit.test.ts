import type { ClickHouseClient } from "@clickhouse/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
import { withStatementLimit } from "../statementLimit";

/**
 * A stand-in for the driver that lets a test decide when each statement
 * finishes, which is the only way to observe a bound: with instant statements
 * nothing ever waits.
 */
function deferrableClient() {
  const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> =
    [];
  let started = 0;

  const settle = (params: unknown) => {
    void params;
    started += 1;
    return new Promise<{ ok: true }>((resolve, reject) => {
      pending.push({ resolve: () => resolve({ ok: true }), reject });
    });
  };

  return {
    client: {
      query: vi.fn(settle),
      insert: vi.fn(settle),
      command: vi.fn(settle),
      exec: vi.fn(settle),
    } as unknown as ClickHouseClient,
    get started() {
      return started;
    },
    releaseAll() {
      const inFlight = pending.splice(0, pending.length);
      for (const entry of inFlight) entry.resolve();
    },
  };
}

/** Lets queued microtasks run so an admitted statement can actually start. */
const settleMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

describe("withStatementLimit", () => {
  let instance: string;

  beforeEach(() => {
    // A fresh label per test so the module-level metric registry never carries
    // one test's limiter into the next.
    instance = `test-${Math.random().toString(36).slice(2)}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given more statements than the bound allows", () => {
    describe("when the surplus is issued", () => {
      it("starts only as many statements as the bound", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 2,
          instance,
        });

        const inFlight = [
          limited.query({ query: "SELECT 1" }),
          limited.query({ query: "SELECT 2" }),
          limited.query({ query: "SELECT 3" }),
        ];
        await settleMicrotasks();

        expect(driver.started).toBe(2);

        driver.releaseAll();
        await settleMicrotasks();
        driver.releaseAll();
        await Promise.all(inFlight);
      });

      it("admits a waiting statement once a slot frees", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 1,
          instance,
        });

        const inFlight = [
          limited.query({ query: "SELECT 1" }),
          limited.query({ query: "SELECT 2" }),
        ];
        await settleMicrotasks();
        expect(driver.started).toBe(1);

        driver.releaseAll();
        await settleMicrotasks();

        expect(driver.started).toBe(2);

        driver.releaseAll();
        await Promise.all(inFlight);
      });
    });
  });

  describe("given a full wait queue", () => {
    describe("when another statement is issued", () => {
      it("refuses it as overload rather than queueing further", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 1,
          // The floor keeps a small pool from shedding on ordinary
          // burstiness, so the queue is 64 deep even at maxConcurrent 1.
          instance,
        });

        const admitted = limited.query({ query: "SELECT 1" });
        const queued = Array.from({ length: 64 }, (_, index) =>
          limited.query({ query: `SELECT q${index}` }),
        );
        await settleMicrotasks();

        await expect(limited.query({ query: "SELECT shed" })).rejects.toThrow(
          ClickHouseOverloadedError,
        );

        driver.releaseAll();
        for (let round = 0; round < 65; round += 1) {
          await settleMicrotasks();
          driver.releaseAll();
        }
        await Promise.all([admitted, ...queued]);
      });

      it("never reaches the driver with the refused statement", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 1,
          instance,
        });

        const admitted = limited.query({ query: "SELECT 1" });
        const queued = Array.from({ length: 64 }, () =>
          limited.query({ query: "SELECT queued" }),
        );
        await settleMicrotasks();

        const startedBeforeShed = driver.started;
        await expect(
          limited.query({ query: "SELECT shed" }),
        ).rejects.toBeInstanceOf(ClickHouseOverloadedError);

        expect(driver.started).toBe(startedBeforeShed);

        driver.releaseAll();
        for (let round = 0; round < 65; round += 1) {
          await settleMicrotasks();
          driver.releaseAll();
        }
        await Promise.all([admitted, ...queued]);
      });
    });
  });

  describe("given a statement waiting for a slot", () => {
    describe("when the caller abandons the request", () => {
      it("stops waiting instead of holding its place", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 1,
          instance,
        });

        const admitted = limited.query({ query: "SELECT 1" });
        const controller = new AbortController();
        const abandoned = limited.query({
          query: "SELECT 2",
          abort_signal: controller.signal,
        });
        await settleMicrotasks();

        controller.abort();

        await expect(abandoned).rejects.toThrow();
        expect(driver.started).toBe(1);

        driver.releaseAll();
        await admitted;
      });
    });
  });

  describe("given a statement that fails inside the driver", () => {
    describe("when it is not a refusal", () => {
      it("surfaces the driver's own error untranslated", async () => {
        const failure = new Error("Code: 62. DB::Exception: Syntax error");
        const client = {
          query: vi.fn().mockRejectedValue(failure),
        } as unknown as ClickHouseClient;

        const limited = withStatementLimit({
          client,
          maxConcurrent: 4,
          instance,
        });

        await expect(limited.query({ query: "SELEKT 1" })).rejects.toBe(
          failure,
        );
      });

      it("frees the slot it held", async () => {
        const client = {
          query: vi.fn().mockRejectedValue(new Error("boom")),
        } as unknown as ClickHouseClient;

        const limited = withStatementLimit({
          client,
          maxConcurrent: 1,
          instance,
        });

        await expect(limited.query({ query: "SELECT 1" })).rejects.toThrow();
        await expect(limited.query({ query: "SELECT 2" })).rejects.toThrow();

        expect(client.query).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given the driver's other statement methods", () => {
    describe("when they are issued", () => {
      it("bounds inserts, commands and execs alongside queries", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 2,
          instance,
        });

        const inFlight = [
          limited.insert({ table: "spans", values: [] }),
          limited.command({ query: "OPTIMIZE TABLE spans" }),
          limited.exec({ query: "SELECT 1" }),
        ];
        await settleMicrotasks();

        // Two of the three start; the third waits behind them, which is the
        // point - a write path that ignored the bound would be the one that
        // rejected live ingest.
        expect(driver.started).toBe(2);

        driver.releaseAll();
        await settleMicrotasks();
        driver.releaseAll();
        await Promise.all(inFlight);
      });
    });
  });
});
