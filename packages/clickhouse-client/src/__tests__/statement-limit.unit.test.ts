import { AcquireAbortedError, QueueFullError, type LimiterStats } from "@langwatch/limiter";
/**
 * The client-side statement bound: how many statements reach ClickHouse at
 * once, what happens to the surplus, and who may stop waiting. A deferrable
 * driver stands in for the vendor client, since instant statements never wait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClickHouseClientCreationInput } from "../connection.ts";
import {
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseStatementAdmission,
  DEFAULT_CLICKHOUSE_REQUEST_TIMEOUT_MS,
  DEFAULT_MIN_STATEMENT_QUEUE_DEPTH,
  DEFAULT_STATEMENT_WAIT_TIMEOUT_MS,
  statementLaneCaps,
  withClickHouseStatementLimit,
  type ClickHouseStatementOperation,
  type ClickHouseVendorClient,
} from "../managed-client.ts";

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
  const pending: (() => void)[] = [];
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
    } satisfies ClickHouseVendorClient,
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

const limit = <Client extends ClickHouseVendorClient>(
  client: Client,
  maxOpenConnections: number,
  options: {
    statementWaitTimeoutMs?: number;
    minimumStatementQueueDepth?: number;
    statementQueueDepthPerSlot?: number;
    statementLaneReserveShare?: number;
  } = {},
) =>
  withClickHouseStatementLimit({
    client,
    input: input(maxOpenConnections),
    telemetry: new SilentTelemetry(),
    overloadErrorFactory: new OverloadFactory(),
    ...options,
  });

/** Releases every pending statement, round after round, so the waiting ones get to finish. */
async function drain(driver: ReturnType<typeof deferrableClient>, rounds: number) {
  for (let round = 0; round < rounds; round += 1) {
    driver.releaseAll();
    await settleMicrotasks();
  }
}

/** A split budget of four: a reserve of one, so each lane caps at three. */
const SPLIT_BUDGET = 4;

describe("given more statements than the bound allows", () => {
  describe("when the surplus is issued", () => {
    /** @scenario statements are bounded, and the bound is the one that binds */
    it("starts only as many statements as the bound", async () => {
      const driver = deferrableClient();
      // A budget of four reserves one slot for inserts, so a fourth read waits.
      const limited = limit(driver.client, SPLIT_BUDGET);

      const inFlight = [1, 2, 3, 4].map((n) => limited.query({ query: `SELECT ${n}` }));
      await settleMicrotasks();

      expect(driver.started).toBe(3);

      await drain(driver, 2);
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
      const releases: (() => void)[] = [];

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
      } satisfies ClickHouseVendorClient;

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

describe("given a bound of a few slots, and a bound of many", () => {
  describe("when the wait queue is sized for each", () => {
    /** @scenario the wait queue is sized from the bound, never below its floor */
    it("holds eight statements per slot, and never fewer than 64", () => {
      const queueFor = (maxConcurrent: number) =>
        new ClickHouseStatementAdmission({
          instance: "test",
          maxConcurrent,
          telemetry: new SilentTelemetry(),
          overloadErrorFactory: new OverloadFactory(),
        }).maxQueued;

      expect(queueFor(2)).toBe(64);
      expect(queueFor(20)).toBe(160);
    });
  });
});

describe("given a statement waiting for a slot that never frees", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the wait bound elapses", () => {
    /** @scenario a statement that waits too long is refused, not left waiting */
    it("refuses it as overload, counts it as shed, and leaves the running statement alone", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const driver = deferrableClient();
      const telemetry = new SilentTelemetry();
      const limited = withClickHouseStatementLimit({
        client: driver.client,
        input: input(1),
        telemetry,
        overloadErrorFactory: new OverloadFactory(),
      });

      const running = limited.query({ query: "SELECT 1" });
      const waiting = limited.query({ query: "SELECT 2" }).then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(DEFAULT_STATEMENT_WAIT_TIMEOUT_MS);

      expect(await waiting).toBeInstanceOf(OverloadedError);
      expect(telemetry.shed).toEqual(["query"]);
      expect(driver.started).toBe(1);

      driver.releaseAll();
      await expect(running).resolves.toEqual({ ok: true });
    });

    /** @scenario a statement that waits too long is refused, not left waiting */
    it("is shorter than the time one statement may spend on the wire", () => {
      expect(DEFAULT_STATEMENT_WAIT_TIMEOUT_MS).toBe(20_000);
      expect(DEFAULT_STATEMENT_WAIT_TIMEOUT_MS).toBeLessThan(DEFAULT_CLICKHOUSE_REQUEST_TIMEOUT_MS);
    });
  });
});

describe("given the insert lane is saturated", () => {
  describe("when a read is issued", () => {
    /** @scenario a saturated insert lane does not delay reads */
    it("starts the read at once and keeps the surplus inserts waiting", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, SPLIT_BUDGET);

      const inserts = Array.from({ length: 4 }, () =>
        limited.insert({ table: "spans", values: [] }),
      );
      await settleMicrotasks();
      expect(driver.started).toBe(3);

      const read = limited.query({ query: "SELECT 1" });
      await settleMicrotasks();

      expect(driver.client.query).toHaveBeenCalledTimes(1);
      expect(driver.client.insert).toHaveBeenCalledTimes(3);

      await drain(driver, 4);
      await Promise.all([...inserts, read]);
    });
  });
});

describe("given the read lane is saturated", () => {
  describe("when an insert is issued", () => {
    /** @scenario a saturated read lane does not delay inserts */
    it("starts the insert at once", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, SPLIT_BUDGET);

      const reads = [0, 1, 2, 3].map((n) => limited.query({ query: `SELECT ${n}` }));
      await settleMicrotasks();
      expect(driver.started).toBe(3);

      const insert = limited.insert({ table: "spans", values: [] });
      await settleMicrotasks();

      expect(driver.client.insert).toHaveBeenCalledTimes(1);

      await drain(driver, 4);
      await Promise.all([...reads, insert]);
    });
  });
});

describe("given only reads are issued and no inserts", () => {
  describe("when more reads arrive than a fixed half-budget would allow", () => {
    /** @scenario a lone kind of work borrows the idle lane's capacity */
    it("borrows the idle insert lane's slots, keeping only its reserve", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, SPLIT_BUDGET);

      const reads = [0, 1, 2].map((n) => limited.query({ query: `SELECT ${n}` }));
      await settleMicrotasks();
      expect(driver.started).toBe(3);

      const insert = limited.insert({ table: "spans", values: [] });
      await settleMicrotasks();

      expect(driver.client.insert).toHaveBeenCalledTimes(1);
      expect(driver.started).toBe(4);

      await drain(driver, 2);
      await Promise.all([...reads, insert]);
    });
  });
});

describe("given both lanes have more statements than they can run", () => {
  describe("when the statements are issued", () => {
    /** @scenario both lanes together never exceed the connection budget */
    it("starts no more than the whole budget", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, SPLIT_BUDGET);

      const inFlight = [
        ...Array.from({ length: 10 }, (_, n) => limited.query({ query: `SELECT ${n}` })),
        ...Array.from({ length: 10 }, () => limited.insert({ table: "spans", values: [] })),
      ];
      await settleMicrotasks();

      expect(driver.started).toBe(4);

      await drain(driver, 6);
      await Promise.all(inFlight);
    });
  });
});

describe("given a saturated read lane cap below the total", () => {
  const saturateReadCap = (limited: ReturnType<typeof limit>) =>
    [0, 1, 2].map((n) => limited.query({ query: `SELECT ${n}` }));

  describe("when a further read waits past the wait bound", () => {
    /** @scenario a statement that waits too long is refused, not left waiting */
    it("refuses it on the cap as overload while the total still has a slot", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, SPLIT_BUDGET, { statementWaitTimeoutMs: 20 });

      const inFlight = saturateReadCap(limited);
      await settleMicrotasks();

      await expect(limited.query({ query: "SELECT waiting" })).rejects.toBeInstanceOf(
        OverloadedError,
      );
      expect(driver.started).toBe(3);

      driver.releaseAll();
      await Promise.all(inFlight);
    });
  });

  describe("when the read cap's wait queue is already full", () => {
    /** @scenario an overloaded process refuses rather than queueing without limit */
    it("refuses the next read as overload", async () => {
      const driver = deferrableClient();
      // A total queue of four gives each lane a queue of two.
      const limited = limit(driver.client, SPLIT_BUDGET, {
        minimumStatementQueueDepth: 4,
        statementQueueDepthPerSlot: 0,
      });

      const inFlight = saturateReadCap(limited);
      const queued = [limited.query({ query: "SELECT q0" }), limited.query({ query: "SELECT q1" })];
      await settleMicrotasks();

      const startedBeforeShed = driver.started;
      await expect(limited.query({ query: "SELECT shed" })).rejects.toBeInstanceOf(OverloadedError);
      expect(driver.started).toBe(startedBeforeShed);

      await drain(driver, 3);
      await Promise.all([...inFlight, ...queued]);
    });
  });

  describe("when the caller abandons a read queued on the cap", () => {
    /** @scenario a caller that gives up stops waiting */
    it("reports the abort rather than overload", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, SPLIT_BUDGET);

      const inFlight = saturateReadCap(limited);
      const controller = new AbortController();
      const abandoned = limited.query({
        query: "SELECT abandoned",
        abort_signal: controller.signal,
      });
      await settleMicrotasks();

      controller.abort();

      await expect(abandoned).rejects.toBeInstanceOf(AcquireAbortedError);
      expect(driver.started).toBe(3);

      driver.releaseAll();
      await Promise.all(inFlight);
    });
  });
});

describe("given the whole budget is taken within one tick", () => {
  describe("when a statement with lane room but no total slot arrives in the same tick", () => {
    /** @scenario a same-tick statement blocked only on the total is still bounded */
    it("refuses it as overload, armed at the total, before it reaches the driver", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, SPLIT_BUDGET, { statementWaitTimeoutMs: 20 });

      const fillers = [
        limited.query({ query: "SELECT 1" }),
        limited.query({ query: "SELECT 2" }),
        limited.query({ query: "SELECT 3" }),
        limited.insert({ table: "spans", values: [] }),
      ];
      const blocked = limited.insert({ table: "spans", values: [] });

      await expect(blocked).rejects.toBeInstanceOf(OverloadedError);
      expect(driver.client.insert).toHaveBeenCalledTimes(1);
      expect(driver.started).toBe(4);

      await drain(driver, 2);
      await Promise.all(fillers);
    });
  });

  describe("when the total was already full in an earlier tick", () => {
    it("refuses the lane-roomy statement as overload", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, SPLIT_BUDGET, { statementWaitTimeoutMs: 20 });

      const fillers = [
        limited.query({ query: "SELECT 1" }),
        limited.query({ query: "SELECT 2" }),
        limited.query({ query: "SELECT 3" }),
        limited.insert({ table: "spans", values: [] }),
      ];
      await settleMicrotasks();
      expect(driver.started).toBe(4);

      await expect(limited.insert({ table: "spans", values: [] })).rejects.toBeInstanceOf(
        OverloadedError,
      );
      expect(driver.client.insert).toHaveBeenCalledTimes(1);

      await drain(driver, 2);
      await Promise.all(fillers);
    });
  });
});

describe("given a configured reserve share", () => {
  describe("when inserts flood a budget of eight with a quarter reserved", () => {
    it("holds inserts to the budget less the reserve", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, 8, { statementLaneReserveShare: 0.25 });

      const inserts = Array.from({ length: 8 }, () =>
        limited.insert({ table: "spans", values: [] }),
      );
      await settleMicrotasks();

      expect(driver.started).toBe(6);

      await drain(driver, 3);
      await Promise.all(inserts);
    });
  });
});

describe("given a budget of one", () => {
  describe("when a read and an insert are issued", () => {
    it("shares the single slot between them", async () => {
      const driver = deferrableClient();
      const limited = limit(driver.client, 1);

      const inFlight = [
        limited.insert({ table: "spans", values: [] }),
        limited.query({ query: "SELECT 1" }),
      ];
      await settleMicrotasks();

      expect(driver.started).toBe(1);

      await drain(driver, 2);
      await Promise.all(inFlight);
    });
  });
});

describe("given a saturated insert lane", () => {
  let limiter: ClickHouseStatementAdmission;
  let releases: (() => void)[];
  const hold = () => new Promise<void>((resolve) => releases.push(resolve));
  const releaseEverything = async () => {
    for (let round = 0; round < 4; round += 1) {
      for (const release of releases.splice(0)) release();
      await settleMicrotasks();
    }
  };

  beforeEach(() => {
    releases = [];
    limiter = new ClickHouseStatementAdmission({
      instance: "lanes",
      maxConcurrent: SPLIT_BUDGET,
      telemetry: new SilentTelemetry(),
      overloadErrorFactory: new OverloadFactory(),
    });
  });

  describe("when the lane stats are read", () => {
    it("reports the insert lane at its cap, the surplus queued, and the read lane idle", async () => {
      const inserts = [0, 1, 2, 3].map(() => limiter.run({ operation: "insert", task: hold }));
      await settleMicrotasks();

      expect(limiter.laneStats()).toEqual([
        { lane: "insert", inFlight: 3, queued: 1 },
        { lane: "read", inFlight: 0, queued: 0 },
      ]);

      await releaseEverything();
      await Promise.all(inserts);
    });

    it("counts inserts holding a lane slot but blocked on the total as queued", async () => {
      const running = [
        ...[0, 1, 2].map(() => limiter.run({ operation: "query", task: hold })),
        ...[0, 1, 2].map(() => limiter.run({ operation: "insert", task: hold })),
      ];
      await settleMicrotasks();

      expect(limiter.laneStats().find(({ lane }) => lane === "insert")).toEqual({
        lane: "insert",
        inFlight: 1,
        queued: 2,
      });

      await releaseEverything();
      await Promise.all(running);
    });
  });
});

describe("statementLaneCaps", () => {
  describe.each([
    { maxConcurrent: 4, reserveShare: 0.25, reserve: 1, laneCap: 3 },
    { maxConcurrent: 10, reserveShare: 0.3, reserve: 3, laneCap: 7 },
    { maxConcurrent: 2, reserveShare: 0.5, reserve: 1, laneCap: 1 },
    { maxConcurrent: 5, reserveShare: 0.01, reserve: 1, laneCap: 4 },
    { maxConcurrent: 8, reserveShare: 0.9, reserve: 4, laneCap: 4 },
  ])(
    "given a budget of $maxConcurrent and a reserve share of $reserveShare",
    ({ maxConcurrent, reserveShare, reserve, laneCap }) => {
      it(`reserves ${reserve} and caps each lane at ${laneCap}, within the whole budget`, () => {
        const caps = statementLaneCaps({ maxConcurrent, reserveShare });
        expect(caps).toEqual({ reserve, laneCap });
        expect((caps?.laneCap ?? 0) + (caps?.reserve ?? 0)).toBe(maxConcurrent);
      });
    },
  );

  describe("given a budget of one", () => {
    it("returns null because it cannot reserve against a single slot", () => {
      expect(statementLaneCaps({ maxConcurrent: 1, reserveShare: 0.25 })).toBeNull();
    });
  });
});
