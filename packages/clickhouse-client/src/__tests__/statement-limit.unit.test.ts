/**
 * The client-side statement bound: how many statements this process lets reach
 * ClickHouse at once, what happens to the surplus, and who is allowed to stop
 * waiting.
 *
 * A deferrable driver stands in for the vendor client, because with instant
 * statements nothing ever waits and a bound is unobservable.
 */
import { describe, expect, it, vi } from "vitest";

import type { ClickHouseClientCreationInput } from "../connection";
import {
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  DEFAULT_MIN_STATEMENT_QUEUE_DEPTH,
  withClickHouseStatementLimit,
  type ClickHouseStatementOperation,
  type ClickHouseVendorClient,
} from "../managed-client";
import { AcquireAbortedError, QueueFullError, type LimiterStats } from "../rateLimit";

class OverloadedError extends Error {
  constructor(readonly cause: unknown) {
    super("ClickHouse is overloaded.");
    this.name = "OverloadedError";
  }
}

class OverloadFactory extends ClickHouseOverloadErrorFactory {
  create({ cause }: { cause: unknown }): unknown {
    return new OverloadedError(cause);
  }
}

class SilentTelemetry extends ClickHouseManagedClientTelemetry {
  readonly shed: ClickHouseStatementOperation[] = [];
  registerLimiter(_input: { instance: string; stats: () => LimiterStats }): void {}
  unregisterLimiter(_instance: string): void {}
  observeStatementWait(): void {}
  incrementStatementsShed(input: { operation: ClickHouseStatementOperation }): void {
    this.shed.push(input.operation);
  }
}

const input = (maxOpenConnections: number): ClickHouseClientCreationInput => ({
  url: "http://clickhouse.test:8123",
  instance: `test-${Math.random().toString(36).slice(2)}`,
  cluster: "test",
  maxOpenConnections,
});

/** A driver whose statements finish only when the test says so. */
function deferrableClient() {
  const pending: Array<() => void> = [];
  let started = 0;

  const settle = async () => {
    started += 1;
    await new Promise<void>((resolve) => pending.push(resolve));
    return { ok: true };
  };

  return {
    client: {
      query: vi.fn(settle),
      insert: vi.fn(settle),
      close: vi.fn(async () => undefined),
    } as unknown as ClickHouseVendorClient,
    get started() {
      return started;
    },
    releaseAll() {
      for (const resolve of pending.splice(0, pending.length)) resolve();
    },
  };
}

/** Lets queued microtasks run so an admitted statement can actually start. */
const settleMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

const limit = <Client extends ClickHouseVendorClient>(client: Client, maxOpenConnections: number) =>
  withClickHouseStatementLimit({
    client,
    input: input(maxOpenConnections),
    telemetry: new SilentTelemetry(),
    overloadErrorFactory: new OverloadFactory(),
  });

describe("given more statements than the bound allows", () => {
  describe("when the surplus is issued", () => {
    /** @scenario statements are bounded, and the bound is the one that binds */
    it("starts only as many statements as the bound", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, 2);

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

    /** @scenario statements are bounded, and the bound is the one that binds */
    it("admits a waiting statement once a slot frees", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, 1);

      const inFlight = [limited.query({ query: "SELECT 1" }), limited.query({ query: "SELECT 2" })];
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

describe("given a statement that fails transiently and is retried", () => {
  describe("when the retry runs", () => {
    /**
     * The composition order made concrete: the limiter wraps the resilient
     * client, so one call through it covers every attempt. Composed the other
     * way a retrying statement would release its slot between attempts and
     * rejoin the queue behind work that arrived later, which is how a brief
     * overload turns into a lasting one.
     */
    /** @scenario a slot is held across retries, not taken per attempt */
    it("holds its slot for the whole statement, not per attempt", async () => {
      let attempts = 0;
      let statementsStarted = 0;
      const releases: Array<() => void> = [];

      const retryingClient = {
        query: async () => {
          statementsStarted += 1;
          if (statementsStarted > 1) return { ok: true };
          for (let attempt = 0; attempt < 3; attempt += 1) {
            attempts += 1;
            await new Promise<void>((resolve) => {
              releases.push(resolve);
            });
          }
          return { ok: true };
        },
        insert: async () => ({ ok: true }),
        close: async () => undefined,
      } as unknown as ClickHouseVendorClient;

      const limited = limit(retryingClient, 1);

      const retried = limited.query({ query: "SELECT 1" });
      const behind = limited.query({ query: "SELECT 2" });
      await settleMicrotasks();

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        expect(attempts).toBe(attempt);
        expect(statementsStarted).toBe(1);
        releases.shift()?.();
        await settleMicrotasks();
      }

      await retried;
      await behind;

      expect(attempts).toBe(3);
      expect(statementsStarted).toBe(2);
    });
  });
});

describe("given a full wait queue", () => {
  describe("when another statement is issued", () => {
    /** @scenario an overloaded process refuses rather than queueing without limit */
    it("refuses it as overload rather than queueing further, and never reaches the driver", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, 1);

      const admitted = limited.query({ query: "SELECT 1" });
      const queued = Array.from({ length: DEFAULT_MIN_STATEMENT_QUEUE_DEPTH }, (_, index) =>
        limited.query({ query: `SELECT q${index}` }),
      );
      await settleMicrotasks();

      const startedBeforeShed = driver.started;
      const shed = await limited.query({ query: "SELECT shed" }).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(shed).toBeInstanceOf(OverloadedError);
      expect((shed as OverloadedError).cause).toBeInstanceOf(QueueFullError);
      expect(driver.started).toBe(startedBeforeShed);

      driver.releaseAll();
      for (let round = 0; round <= DEFAULT_MIN_STATEMENT_QUEUE_DEPTH; round += 1) {
        await settleMicrotasks();
        driver.releaseAll();
      }
      await Promise.all([admitted, ...queued]);
    });
  });
});

describe("given a statement waiting for a slot", () => {
  describe("when the caller abandons the request", () => {
    /** @scenario a caller that gives up stops waiting */
    it("stops waiting instead of holding its place", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, 1);

      const admitted = limited.query({ query: "SELECT 1" });
      const controller = new AbortController();
      const abandoned = limited.query({
        query: "SELECT 2",
        abort_signal: controller.signal,
      });
      await settleMicrotasks();

      controller.abort();

      await expect(abandoned).rejects.toBeInstanceOf(AcquireAbortedError);
      expect(driver.started).toBe(1);

      driver.releaseAll();
      await admitted;
    });
  });
});
