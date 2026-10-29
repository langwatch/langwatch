/**
 * Async inserts that wait for a statement slot together go as one statement (ADR-187). The query
 * client runs over a holding driver, which records each statement, and a real admission.
 * Spec: specs/clickhouse/single-client-access.feature
 */
import type { LimiterStats } from "@langwatch/limiter";
import { beforeEach, describe, expect, it } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { coalesceKeyOf } from "../insert-coalescing.ts";
import {
  ClickHouseManagedClientTelemetry,
  ClickHouseOverloadErrorFactory,
  ClickHouseStatementAdmission,
  type ClickHouseStatementOperation,
} from "../managed-client.ts";
import type { InsertRequest, QueryDriver } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

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

/** A budget of four: a reserve of one, so each lane caps at three. */
const SPLIT_BUDGET = 4;
const LANE_CAP = 3;

/** How event_log is written: async, waiting for the flush, async deduplication off. */
const SHARED = {
  async_insert: 1,
  wait_for_async_insert: 1,
  async_insert_deduplicate: 0,
} as const;

type Row = { TenantId: string; n: number; poisoned?: true };

/** An insert that may share a statement, as the event log sends it. */
const asyncInsert = (
  table: string,
  rows: Row[],
  extra: Partial<InsertRequest> = {},
): InsertRequest => ({
  tenantId: "project_a",
  table,
  rows,
  settings: { ...SHARED },
  ...extra,
});

const row = (n: number, tenantId = "project_a"): Row => ({
  TenantId: tenantId,
  n,
});

/** An insert that can share no statement: it sets no async settings. */
const plainInsert = (table: string): InsertRequest => ({
  tenantId: "project_a",
  table,
  rows: [row(0)],
});

/** A ClickHouse server answer with its code, as the vendor client throws it. */
const serverError = (code: string, message: string) => Object.assign(new Error(message), { code });

/**
 * A driver whose statements finish only when the test says so. A poisoned row fails its
 * statement with `failure`, by default the server's parse refusal.
 */
function holdingDriver(failure: () => unknown = () => serverError("27", "Cannot parse input")) {
  const pending: (() => void)[] = [];
  const inserts: InsertRequest[] = [];
  let reads = 0;
  const hold = () => new Promise<void>((resolve) => pending.push(resolve));

  const driver: QueryDriver = {
    async execute() {
      reads += 1;
      await hold();
      return { rows: [] };
    },
    async insert(request) {
      inserts.push(request);
      await hold();
      if (request.rows.some((each) => (each as Row).poisoned === true)) throw failure();
    },
    async command() {},
  };

  return {
    driver,
    inserts,
    reads: () => reads,
    releaseAll() {
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}

type Holding = ReturnType<typeof holdingDriver>;

/** Lets queued microtasks run so an admitted statement can actually start. */
const settleMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

async function drain(holding: Holding, rounds = 6) {
  for (let round = 0; round < rounds; round += 1) {
    holding.releaseAll();
    await settleMicrotasks();
  }
}

function clientOver(
  holding: Holding,
  options: {
    insertCoalesceMaxRows?: number;
    statementWaitTimeoutMs?: number;
  } = {},
) {
  const telemetry = new CountingTelemetry();
  const limiter = new ClickHouseStatementAdmission({
    instance: `test-${Math.random().toString(36).slice(2)}`,
    maxConcurrent: SPLIT_BUDGET,
    telemetry,
    overloadErrorFactory: new OverloadFactory(),
    statementWaitTimeoutMs: options.statementWaitTimeoutMs,
  });
  const client = new ClickHouseQueryClient({
    driver: holding.driver,
    tenantGuard: new TenantGuard(),
    limiter,
    insertCoalesceMaxRows: options.insertCoalesceMaxRows,
  });
  return { client, telemetry };
}

/** Fills the insert lane with inserts that can share nothing, so whatever follows waits. */
async function saturateInsertLane(client: ClickHouseQueryClient) {
  const holders = Array.from({ length: LANE_CAP }, (_, n) =>
    client.insert(plainInsert(`holder_${n}`)),
  );
  await settleMicrotasks();
  return holders;
}

const rowsOf = (request: InsertRequest) => request.rows;
const outcome = (write: Promise<void>) =>
  write.then(
    () => "written",
    (error: unknown) => error,
  );

describe("given the insert lane has used every slot it may hold", () => {
  describe("when several async inserts of one route, table and settings are issued", () => {
    let holding: Holding;
    let client: ClickHouseQueryClient;
    let holders: Promise<void>[];

    beforeEach(async () => {
      holding = holdingDriver();
      ({ client } = clientOver(holding));
      holders = await saturateInsertLane(client);
    });

    /** @scenario async inserts waiting for a slot go as one statement */
    it("sends one statement carrying all their rows once a slot frees", async () => {
      const writes = [1, 2, 3, 4, 5].map((n) => client.insert(asyncInsert("event_log", [row(n)])));
      await settleMicrotasks();
      expect(holding.inserts).toHaveLength(LANE_CAP);

      await drain(holding);
      await Promise.all([...writes, ...holders]);

      const coalesced = holding.inserts.slice(LANE_CAP);
      expect(coalesced).toHaveLength(1);
      expect(coalesced[0]).toEqual(
        asyncInsert(
          "event_log",
          [1, 2, 3, 4, 5].map((n) => row(n)),
        ),
      );
    });

    /** @scenario async inserts waiting for a slot go as one statement */
    it("starts a new statement for inserts that arrive after the first has started", async () => {
      const early = client.insert(asyncInsert("event_log", [row(1)]));
      holding.releaseAll();
      await settleMicrotasks();
      expect(holding.inserts).toHaveLength(LANE_CAP + 1);

      const late = client.insert(asyncInsert("event_log", [row(2)]));
      await drain(holding);
      await Promise.all([early, late, ...holders]);

      expect(holding.inserts.slice(LANE_CAP).map(rowsOf)).toEqual([[row(1)], [row(2)]]);
    });
  });

  describe("when inserts are issued that cannot share a statement", () => {
    /** @scenario only inserts that can share a statement share one */
    it("sends each in its own statement", async () => {
      const holding = holdingDriver();
      const { client } = clientOver(holding);
      const holders = await saturateInsertLane(client);
      const signal = new AbortController().signal;

      const writes = [
        client.insert(asyncInsert("event_log", [row(1)])),
        client.insert(asyncInsert("billable_events", [row(2)])),
        client.insert(
          asyncInsert("event_log", [row(3, "project_b")], {
            tenantId: "project_b",
          }),
        ),
        client.insert(
          asyncInsert("event_log", [row(4)], {
            organizationId: "organization_1",
          }),
        ),
        client.insert(
          asyncInsert("event_log", [row(5)], {
            settings: { ...SHARED, insert_quorum: 2 },
          }),
        ),
        client.insert(
          asyncInsert("event_log", [row(6)], {
            settings: { async_insert: 1, wait_for_async_insert: 1 },
          }),
        ),
        client.insert(
          asyncInsert("event_log", [row(7)], {
            settings: { ...SHARED, async_insert_deduplicate: 1 },
          }),
        ),
        client.insert(
          asyncInsert("event_log", [row(8)], {
            settings: { ...SHARED, insert_deduplication_token: "mine" },
          }),
        ),
        client.insert(asyncInsert("event_log", [row(9)], { signal })),
      ];
      await drain(holding);
      await Promise.all([...writes, ...holders]);

      expect(holding.inserts.slice(LANE_CAP).map(rowsOf)).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [row(n, n === 3 ? "project_b" : "project_a")]),
      );
    });
  });

  describe("when more rows wait for one table than one statement may carry", () => {
    /** @scenario a coalesced statement never exceeds its row cap */
    it("splits them at the cap and sends a larger insert on its own", async () => {
      const holding = holdingDriver();
      const { client } = clientOver(holding, { insertCoalesceMaxRows: 3 });
      const holders = await saturateInsertLane(client);

      const writes = [
        ...[1, 2, 3, 4].map((n) => client.insert(asyncInsert("event_log", [row(n)]))),
        client.insert(
          asyncInsert(
            "event_log",
            [5, 6, 7, 8].map((n) => row(n)),
          ),
        ),
      ];
      await drain(holding);
      await Promise.all([...writes, ...holders]);

      const sizes = holding.inserts.slice(LANE_CAP).map((request) => request.rows.length);
      expect(sizes.toSorted((left, right) => left - right)).toEqual([1, 3, 4]);
    });
  });

  describe("when many empty inserts are issued", () => {
    it("answers them at once and holds none of them", async () => {
      const holding = holdingDriver();
      const { client } = clientOver(holding);
      const holders = await saturateInsertLane(client);

      await Promise.all(
        Array.from({ length: 1_000 }, () => client.insert(asyncInsert("event_log", []))),
      );

      expect(holding.inserts).toHaveLength(LANE_CAP);
      await drain(holding);
      await Promise.all(holders);
    });
  });
});

describe("given the insert lane has a free slot", () => {
  describe("when async inserts are issued in the same tick", () => {
    /** @scenario an async insert with a slot free goes at once, alone */
    it("starts each at once with its own request, untouched", async () => {
      const holding = holdingDriver();
      const { client } = clientOver(holding);
      const requests = [1, 2, 3].map((n) => asyncInsert("event_log", [row(n)]));

      const writes = requests.map((request) => client.insert(request));
      await settleMicrotasks();

      expect(holding.inserts).toHaveLength(3);
      for (const [at, request] of requests.entries()) expect(holding.inserts[at]).toBe(request);

      await drain(holding);
      await Promise.all(writes);
    });
  });

  describe("when coalescing is turned off", () => {
    /** @scenario only inserts that can share a statement share one */
    it("sends every insert alone", async () => {
      const holding = holdingDriver();
      const { client } = clientOver(holding, { insertCoalesceMaxRows: 0 });
      const holders = await saturateInsertLane(client);

      const writes = [1, 2].map((n) => client.insert(asyncInsert("event_log", [row(n)])));
      await drain(holding);
      await Promise.all([...writes, ...holders]);

      expect(holding.inserts.slice(LANE_CAP).map(rowsOf)).toEqual([[row(1)], [row(2)]]);
    });
  });
});

describe("given async inserts are waiting together for a slot that never frees", () => {
  describe("when the wait bound elapses", () => {
    /** @scenario a refused coalesced statement refuses and counts every caller */
    it("refuses every caller as overloaded and counts each as shed", async () => {
      const holding = holdingDriver();
      const { client, telemetry } = clientOver(holding, {
        statementWaitTimeoutMs: 20,
      });
      const holders = await saturateInsertLane(client);

      const outcomes = await Promise.all(
        [1, 2, 3].map((n) => outcome(client.insert(asyncInsert("event_log", [row(n)])))),
      );

      expect(outcomes.every((each) => each instanceof OverloadedError)).toBe(true);
      expect(telemetry.shed).toEqual(["insert", "insert", "insert"]);
      expect(holding.inserts).toHaveLength(LANE_CAP);

      await drain(holding);
      await Promise.all(holders);
    });
  });
});

describe("given async inserts went together as one statement", () => {
  /** Three callers waiting together, the second with a row the server cannot take. */
  async function coalescedWithPoison(failure?: () => unknown) {
    const holding = holdingDriver(failure);
    const { client } = clientOver(holding);
    const holders = await saturateInsertLane(client);
    const writes = [row(1), { ...row(2), poisoned: true as const }, row(3)].map((each) =>
      outcome(client.insert(asyncInsert("event_log", [each]))),
    );
    await drain(holding);
    await Promise.all(holders);
    return { holding, outcomes: await Promise.all(writes) };
  }

  describe("when the server rejects the rows as unparsable", () => {
    // Another client's bad row in the server's async buffer returns this code to every entry
    // flushed with it, after the others were written, so it proves nothing unwritten.
    /** @scenario a failed coalesced statement is never resent */
    it.each([
      { code: "6", message: "Cannot parse text" },
      { code: "27", message: "Cannot parse input" },
    ])("fails every caller with code $code and sends nothing again", async ({ code, message }) => {
      const refused = serverError(code, message);
      const { holding, outcomes } = await coalescedWithPoison(() => refused);

      expect(outcomes).toEqual([refused, refused, refused]);
      expect(holding.inserts).toHaveLength(LANE_CAP + 1);
    });
  });

  describe.each([
    {
      name: "the connection resets",
      failure: () => serverError("ECONNRESET", "socket hang up"),
    },
    {
      name: "the request times out",
      failure: () => new Error("Timeout error."),
    },
    {
      name: "the server times out",
      failure: () => serverError("159", "Timeout exceeded: elapsed 30 seconds"),
    },
    {
      name: "the server is overloaded",
      failure: () => serverError("202", "Too many simultaneous queries"),
    },
  ])("when $name", ({ failure }) => {
    /** @scenario a failed coalesced statement is never resent */
    it("fails every caller with that failure and sends nothing again", async () => {
      const failed = failure();
      const { holding, outcomes } = await coalescedWithPoison(() => failed);

      expect(outcomes).toEqual([failed, failed, failed]);
      expect(holding.inserts).toHaveLength(LANE_CAP + 1);
    });
  });

  describe("when the statement carried one caller only", () => {
    it("fails that caller without sending again", async () => {
      const holding = holdingDriver();
      const { client } = clientOver(holding);
      const holders = await saturateInsertLane(client);

      const write = outcome(
        client.insert(asyncInsert("event_log", [{ ...row(1), poisoned: true }])),
      );
      await drain(holding);
      await Promise.all(holders);

      expect(((await write) as Error).message).toBe("Cannot parse input");
      expect(holding.inserts).toHaveLength(LANE_CAP + 1);
    });
  });
});

describe("given async inserts are waiting together for a slot", () => {
  describe("when a read is issued", () => {
    /** @scenario coalesced inserts keep to the insert lane */
    it("starts the read at once", async () => {
      const holding = holdingDriver();
      const { client } = clientOver(holding);
      const holders = await saturateInsertLane(client);
      const writes = [1, 2].map((n) => client.insert(asyncInsert("event_log", [row(n)])));

      const read = client.query({
        tenantId: "",
        sql: "SELECT 1",
        // A constant probe that reads no table, so it names no tenant.
        SKIP_TENANT_CHECK: true,
      });
      await settleMicrotasks();

      expect(holding.reads()).toBe(1);
      expect(holding.inserts).toHaveLength(LANE_CAP);

      await drain(holding);
      await Promise.all([read, ...writes, ...holders]);
    });
  });
});

describe("given the read lane is saturated", () => {
  describe("when async inserts are issued", () => {
    /** @scenario coalesced inserts keep to the insert lane */
    it("starts them at once", async () => {
      const holding = holdingDriver();
      const { client } = clientOver(holding);
      const reads = [0, 1, 2, 3].map((n) =>
        client.query({
          tenantId: "",
          sql: `SELECT ${n}`,
          // A constant probe that reads no table, so it names no tenant.
          SKIP_TENANT_CHECK: true,
        }),
      );
      await settleMicrotasks();
      expect(holding.reads()).toBe(LANE_CAP);

      const write = client.insert(asyncInsert("event_log", [row(1)]));
      await settleMicrotasks();

      expect(holding.inserts).toHaveLength(1);

      await drain(holding);
      await Promise.all([write, ...reads]);
    });
  });
});

describe("coalesceKeyOf", () => {
  describe("given settings in a different order", () => {
    it("gives the same key", () => {
      const ordered = asyncInsert("t", [row(1)], {
        settings: {
          wait_for_async_insert: 1,
          async_insert: 1,
          async_insert_deduplicate: 0,
          x: 1,
        },
      });
      const shuffled = asyncInsert("t", [row(1)], {
        settings: {
          async_insert_deduplicate: 0,
          x: 1,
          async_insert: 1,
          wait_for_async_insert: 1,
        },
      });
      expect(coalesceKeyOf(ordered)).toBe(coalesceKeyOf(shuffled));
    });
  });

  describe.each([
    { name: "no settings", request: plainInsert("t") },
    {
      name: "async off",
      request: asyncInsert("t", [row(1)], {
        settings: { ...SHARED, async_insert: 0 },
      }),
    },
    {
      name: "no wait for the flush",
      request: asyncInsert("t", [row(1)], {
        settings: { ...SHARED, wait_for_async_insert: 0 },
      }),
    },
    {
      name: "async deduplication left to the server",
      request: asyncInsert("t", [row(1)], {
        settings: { async_insert: 1, wait_for_async_insert: 1 },
      }),
    },
    {
      name: "a deduplication token",
      request: asyncInsert("t", [row(1)], {
        settings: { ...SHARED, insert_deduplication_token: "x" },
      }),
    },
    { name: "no rows", request: asyncInsert("t", []) },
    {
      name: "an abort signal",
      request: asyncInsert("t", [row(1)], {
        signal: new AbortController().signal,
      }),
    },
  ])("given $name", ({ request }) => {
    it("cannot coalesce", () => {
      expect(coalesceKeyOf(request)).toBeNull();
    });
  });
});
