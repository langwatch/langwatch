/**
 * Async inserts that wait for a statement slot together go as one statement: the slots a
 * burst needs follow the tables being written, not the rows. A holding driver stands in for
 * the vendor client and records what each statement carried.
 */
import type { LimiterStats } from "@langwatch/limiter";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClickHouseClientCreationInput } from "../connection.ts";
import { coalesceKeyOf } from "../insert-coalescing.ts";
import {
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
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

class CountingTelemetry extends ClickHouseManagedClientTelemetry {
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

/** A budget of four: a reserve of one, so each lane caps at three. */
const SPLIT_BUDGET = 4;
const LANE_CAP = 3;

const ASYNC = { async_insert: 1, wait_for_async_insert: 1 } as const;

/** An insert the server buffers and the caller waits on, as single-row writers send it. */
const asyncInsert = (
  table: string,
  values: unknown[],
  settings: Record<string, unknown> = ASYNC,
) => ({ table, values, format: "JSONEachRow", clickhouse_settings: settings });

/** An insert that can share no statement: it sets no async settings. */
const plainInsert = (table: string) => ({ table, values: [{ plain: true }] });

/** A driver whose statements finish only when the test says so, failing on a poisoned row. */
function holdingClient() {
  const pending: (() => void)[] = [];
  const inserts: Record<string, unknown>[] = [];

  const hold = () => new Promise<void>((resolve) => pending.push(resolve));

  const client = {
    query: vi.fn(async () => {
      await hold();
      return { ok: true };
    }),
    insert: vi.fn(async (params: unknown) => {
      const record = params as Record<string, unknown>;
      inserts.push(record);
      await hold();
      const values = (record.values ?? []) as { poisoned?: boolean }[];
      if (values.some((row) => row.poisoned === true)) throw new Error("Cannot parse input");
      return { executed: true };
    }),
    close: vi.fn(async () => undefined),
  } satisfies ClickHouseVendorClient;

  return {
    client,
    inserts,
    releaseAll() {
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}

/** Lets queued microtasks run so an admitted statement can actually start. */
const settleMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

async function drain(driver: ReturnType<typeof holdingClient>, rounds = 6) {
  for (let round = 0; round < rounds; round += 1) {
    driver.releaseAll();
    await settleMicrotasks();
  }
}

function limit(
  driver: ReturnType<typeof holdingClient>,
  options: { insertCoalesceMaxRows?: number; statementWaitTimeoutMs?: number } = {},
) {
  const telemetry = new CountingTelemetry();
  const limited = withClickHouseStatementLimit({
    client: driver.client,
    input: input(SPLIT_BUDGET),
    telemetry,
    overloadErrorFactory: new OverloadFactory(),
    ...options,
  });
  return { limited, telemetry };
}

/** Fills the insert lane with inserts that can share nothing, so whatever follows waits. */
async function saturateInsertLane(limited: ClickHouseVendorClient) {
  const holders = Array.from({ length: LANE_CAP }, (_, n) =>
    limited.insert(plainInsert(`holder_${n}`)),
  );
  await settleMicrotasks();
  return holders;
}

const rowsOf = (params: Record<string, unknown>) => params.values as unknown[];

describe("given the insert lane has used every slot it may hold", () => {
  describe("when several async inserts into one table with the same settings are issued", () => {
    let driver: ReturnType<typeof holdingClient>;
    let limited: ClickHouseVendorClient;
    let holders: Promise<unknown>[];

    beforeEach(async () => {
      driver = holdingClient();
      ({ limited } = limit(driver));
      holders = await saturateInsertLane(limited);
    });

    /** @scenario async inserts waiting for a slot go as one statement */
    it("sends one statement carrying all their rows once a slot frees", async () => {
      const writes = [1, 2, 3, 4, 5].map((n) =>
        limited.insert(asyncInsert("billable_events", [{ n }])),
      );
      await settleMicrotasks();
      expect(driver.inserts).toHaveLength(LANE_CAP);

      await drain(driver);
      const results = await Promise.all(writes);
      await Promise.all(holders);

      const coalesced = driver.inserts.slice(LANE_CAP);
      expect(coalesced).toHaveLength(1);
      expect(coalesced[0]).toEqual(
        asyncInsert("billable_events", [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]),
      );
      expect(results).toEqual(Array.from({ length: 5 }, () => ({ executed: true })));
    });

    /** @scenario async inserts waiting for a slot go as one statement */
    it("starts a new statement for inserts that arrive after the first has started", async () => {
      const early = limited.insert(asyncInsert("billable_events", [{ n: 1 }]));
      driver.releaseAll();
      await settleMicrotasks();
      expect(driver.inserts).toHaveLength(LANE_CAP + 1);

      const late = limited.insert(asyncInsert("billable_events", [{ n: 2 }]));
      await drain(driver);
      await Promise.all([early, late, ...holders]);

      expect(driver.inserts.slice(LANE_CAP).map(rowsOf)).toEqual([[{ n: 1 }], [{ n: 2 }]]);
    });
  });

  describe("when inserts are issued that cannot share a statement", () => {
    /** @scenario only inserts that can share a statement share one */
    it("sends each in its own statement", async () => {
      const driver = holdingClient();
      const { limited } = limit(driver);
      const holders = await saturateInsertLane(limited);

      const writes = [
        limited.insert(asyncInsert("billable_events", [{ n: 1 }])),
        limited.insert(asyncInsert("event_log", [{ n: 2 }])),
        limited.insert(asyncInsert("billable_events", [{ n: 3 }], { ...ASYNC, insert_quorum: 2 })),
        limited.insert(asyncInsert("billable_events", [{ n: 4 }], { async_insert: 1 })),
        limited.insert({ ...asyncInsert("billable_events", [{ n: 5 }]), query_id: "mine" }),
      ];
      await drain(driver);
      await Promise.all([...writes, ...holders]);

      expect(driver.inserts.slice(LANE_CAP).map(rowsOf)).toEqual([
        [{ n: 1 }],
        [{ n: 2 }],
        [{ n: 3 }],
        [{ n: 4 }],
        [{ n: 5 }],
      ]);
    });
  });

  describe("when more rows wait for one table than one statement may carry", () => {
    /** @scenario a coalesced statement never exceeds its row cap */
    it("splits them at the cap and sends a larger insert on its own", async () => {
      const driver = holdingClient();
      const { limited } = limit(driver, { insertCoalesceMaxRows: 3 });
      const holders = await saturateInsertLane(limited);

      const writes = [
        ...[1, 2, 3, 4].map((n) => limited.insert(asyncInsert("billable_events", [{ n }]))),
        limited.insert(
          asyncInsert(
            "billable_events",
            [5, 6, 7, 8].map((n) => ({ n })),
          ),
        ),
      ];
      await drain(driver);
      await Promise.all([...writes, ...holders]);

      const sizes = driver.inserts.slice(LANE_CAP).map((params) => rowsOf(params).length);
      expect(sizes).toEqual([3, 1, 4]);
    });
  });
});

describe("given the insert lane has a free slot", () => {
  describe("when an async insert is issued", () => {
    /** @scenario an async insert with a slot free goes at once, alone */
    it("starts it at once with its own parameters, untouched", async () => {
      const driver = holdingClient();
      const { limited } = limit(driver);
      const params = asyncInsert("billable_events", [{ n: 1 }]);

      const write = limited.insert(params);
      await settleMicrotasks();

      expect(driver.inserts).toEqual([params]);
      expect(driver.inserts[0]).toBe(params);

      await drain(driver);
      await write;
    });
  });

  describe("when coalescing is turned off", () => {
    /** @scenario only inserts that can share a statement share one */
    it("sends every insert alone", async () => {
      const driver = holdingClient();
      const { limited } = limit(driver, { insertCoalesceMaxRows: 0 });
      const holders = await saturateInsertLane(limited);

      const writes = [1, 2].map((n) => limited.insert(asyncInsert("billable_events", [{ n }])));
      await drain(driver);
      await Promise.all([...writes, ...holders]);

      expect(driver.inserts.slice(LANE_CAP).map(rowsOf)).toEqual([[{ n: 1 }], [{ n: 2 }]]);
    });
  });
});

describe("given async inserts are waiting together for a slot that never frees", () => {
  describe("when the wait bound elapses", () => {
    /** @scenario a refused coalesced statement refuses and counts every caller */
    it("refuses every caller as overloaded and counts each as shed", async () => {
      const driver = holdingClient();
      const { limited, telemetry } = limit(driver, { statementWaitTimeoutMs: 20 });
      const holders = await saturateInsertLane(limited);

      const writes = [1, 2, 3].map((n) =>
        limited.insert(asyncInsert("billable_events", [{ n }])).catch((error: unknown) => error),
      );
      const outcomes = await Promise.all(writes);

      expect(outcomes.every((outcome) => outcome instanceof OverloadedError)).toBe(true);
      expect(telemetry.shed).toEqual(["insert", "insert", "insert"]);
      expect(driver.inserts).toHaveLength(LANE_CAP);

      await drain(driver);
      await Promise.all(holders);
    });
  });
});

describe("given async inserts went together as one statement", () => {
  describe("when the server rejects the statement", () => {
    /** @scenario a coalesced statement that fails is retried caller by caller */
    it("resends each caller alone, so only the caller with the bad row fails", async () => {
      const driver = holdingClient();
      const { limited } = limit(driver);

      const [good, bad, alsoGood] = [{ n: 1 }, { n: 2, poisoned: true }, { n: 3 }].map((row) =>
        limited.insert(asyncInsert("billable_events", [row])).then(
          () => "written",
          (error: unknown) => (error as Error).message,
        ),
      );
      await drain(driver);

      expect(await Promise.all([good, bad, alsoGood])).toEqual([
        "written",
        "Cannot parse input",
        "written",
      ]);
      expect(driver.inserts.map((params) => rowsOf(params).length)).toEqual([3, 1, 1, 1]);
    });
  });

  describe("when the statement fails for a single caller", () => {
    it("fails that caller without sending again", async () => {
      const driver = holdingClient();
      const { limited } = limit(driver);

      const write = limited
        .insert(asyncInsert("billable_events", [{ poisoned: true }]))
        .catch((error: unknown) => (error as Error).message);
      await drain(driver);

      expect(await write).toBe("Cannot parse input");
      expect(driver.inserts).toHaveLength(1);
    });
  });
});

describe("given async inserts are waiting together for a slot", () => {
  describe("when a read is issued", () => {
    /** @scenario coalesced inserts keep to the insert lane */
    it("starts the read at once", async () => {
      const driver = holdingClient();
      const { limited } = limit(driver);
      const holders = await saturateInsertLane(limited);
      const writes = [1, 2].map((n) => limited.insert(asyncInsert("billable_events", [{ n }])));

      const read = limited.query({ query: "SELECT 1" });
      await settleMicrotasks();

      expect(driver.client.query).toHaveBeenCalledTimes(1);
      expect(driver.inserts).toHaveLength(LANE_CAP);

      await drain(driver);
      await Promise.all([read, ...writes, ...holders]);
    });
  });
});

describe("given the read lane is saturated", () => {
  describe("when async inserts are issued", () => {
    /** @scenario coalesced inserts keep to the insert lane */
    it("starts them at once", async () => {
      const driver = holdingClient();
      const { limited } = limit(driver);
      const reads = [0, 1, 2, 3].map((n) => limited.query({ query: `SELECT ${n}` }));
      await settleMicrotasks();
      expect(driver.client.query).toHaveBeenCalledTimes(LANE_CAP);

      const write = limited.insert(asyncInsert("billable_events", [{ n: 1 }]));
      await settleMicrotasks();

      expect(driver.inserts).toHaveLength(1);

      await drain(driver);
      await Promise.all([write, ...reads]);
    });
  });
});

describe("coalesceKeyOf", () => {
  describe("given settings in a different order", () => {
    it("gives the same key", () => {
      expect(
        coalesceKeyOf(asyncInsert("t", [], { wait_for_async_insert: 1, async_insert: 1, x: "a" })),
      ).toBe(
        coalesceKeyOf(asyncInsert("t", [], { async_insert: 1, x: "a", wait_for_async_insert: 1 })),
      );
    });
  });

  describe.each([
    { name: "no settings", params: { table: "t", values: [], format: "JSONEachRow" } },
    {
      name: "async off",
      params: asyncInsert("t", [], { async_insert: 0, wait_for_async_insert: 1 }),
    },
    {
      name: "no wait for the flush",
      params: asyncInsert("t", [], { async_insert: 1, wait_for_async_insert: 0 }),
    },
    { name: "a stream of values", params: { ...asyncInsert("t", []), values: "a stream" } },
    { name: "an abort signal", params: { ...asyncInsert("t", []), abort_signal: {} } },
  ])("given $name", ({ params }) => {
    it("cannot coalesce", () => {
      expect(coalesceKeyOf(params)).toBeNull();
    });
  });
});
