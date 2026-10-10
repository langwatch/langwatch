import type { ClickHouseClient } from "@clickhouse/client";
import { AcquireAbortedError } from "@langwatch/clickhouse-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClickHouseOverloadedError } from "~/server/app-layer/traces/errors";
import { CLICKHOUSE_REQUEST_TIMEOUT_MS } from "../managedClient";
import { clickHouseConcurrencyMetrics } from "../metrics";
import {
  MIN_QUEUE_DEPTH,
  STATEMENT_WAIT_TIMEOUT_MS,
  statementLaneCaps,
  withStatementLimit,
} from "../statementLimit";

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
      /** @scenario statements are bounded, and the bound is the one that binds */
      it("starts only as many statements as the bound", async () => {
        const driver = deferrableClient();
        // 4 with a reserve of 1 leaves each lane a cap of 3, so a fourth read
        // has no read slot and waits.
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const inFlight = [
          limited.query({ query: "SELECT 1" }),
          limited.query({ query: "SELECT 2" }),
          limited.query({ query: "SELECT 3" }),
          limited.query({ query: "SELECT 4" }),
        ];
        await settleMicrotasks();

        expect(driver.started).toBe(3);

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

  describe("given a statement that fails transiently and is retried", () => {
    describe("when the retry runs", () => {
      /**
       * The composition order made concrete. `managedClient.ts` wraps the
       * resilient client - which retries internally - so one call through the
       * limiter covers every attempt. Composed the other way, a retrying
       * statement would release its slot between attempts and rejoin the queue
       * behind work that arrived later, which is how a brief overload turns
       * into a lasting one.
       */
      /** @scenario a slot is held across retries, not taken per attempt */
      it("holds its slot for the whole statement, not per attempt", async () => {
        let attempts = 0;
        let statementsStarted = 0;
        // A queue rather than a single slot: TypeScript narrows a `let` that
        // is only ever assigned inside a closure back to its initialiser at
        // the call site, so the obvious shape does not type-check.
        const releases: Array<() => void> = [];

        // Stands in for the resilient client: the FIRST statement retries
        // inside one call, every later one answers at once. Only the first
        // needs to be slow - the question is whether the second can start
        // while the first is between attempts.
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
        } as unknown as ClickHouseClient;

        const limited = withStatementLimit({
          client: retryingClient,
          maxConcurrent: 1,
          instance,
        });

        const retried = limited.query({ query: "SELECT 1" });
        const behind = limited.query({ query: "SELECT 2" });
        await settleMicrotasks();

        // Walk the retrying statement through its attempts. The statement
        // queued behind it must not start at any point in between.
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          expect(attempts).toBe(attempt);
          expect(statementsStarted).toBe(1);
          releases.shift()?.();
          await settleMicrotasks();
        }

        await retried;
        await behind;

        // Three attempts, but only ever one slot: the second statement waited
        // for the first to finish rather than interleaving with its retries.
        expect(attempts).toBe(3);
        expect(statementsStarted).toBe(2);
      });
    });
  });

  describe("given a full wait queue", () => {
    describe("when another statement is issued", () => {
      /** @scenario an overloaded process refuses rather than queueing without limit */
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
        const queued = Array.from({ length: MIN_QUEUE_DEPTH }, (_, index) =>
          limited.query({ query: `SELECT q${index}` }),
        );
        await settleMicrotasks();

        await expect(limited.query({ query: "SELECT shed" })).rejects.toThrow(
          ClickHouseOverloadedError,
        );

        driver.releaseAll();
        for (let round = 0; round <= MIN_QUEUE_DEPTH; round += 1) {
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
        const queued = Array.from({ length: MIN_QUEUE_DEPTH }, () =>
          limited.query({ query: "SELECT queued" }),
        );
        await settleMicrotasks();

        const startedBeforeShed = driver.started;
        await expect(
          limited.query({ query: "SELECT shed" }),
        ).rejects.toBeInstanceOf(ClickHouseOverloadedError);

        expect(driver.started).toBe(startedBeforeShed);

        driver.releaseAll();
        for (let round = 0; round <= MIN_QUEUE_DEPTH; round += 1) {
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

        await expect(abandoned).rejects.toBeInstanceOf(AcquireAbortedError);
        expect(driver.started).toBe(1);

        driver.releaseAll();
        await admitted;
      });
    });

    /**
     * The queue was bounded by depth but not by time. A statement could wait
     * for as long as everything ahead of it took and then still spend the
     * driver's full request timeout on the wire — which is how a 46-second
     * failure was assembled out of two limits, neither of which was 46 seconds.
     */
    describe("when no slot arrives before the wait runs out", () => {
      /** @scenario a statement that waits too long is refused, not left waiting */
      it("refuses it as overload rather than waiting indefinitely", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 1,
          instance,
          waitTimeoutMs: 20,
        });

        const admitted = limited.query({ query: "SELECT 1" });
        const waiting = limited.query({ query: "SELECT 2" });

        await expect(waiting).rejects.toBeInstanceOf(ClickHouseOverloadedError);

        // The one already running is untouched — only the wait was bounded.
        expect(driver.started).toBe(1);

        driver.releaseAll();
        await admitted;
      });

      it("keeps the production bound well inside the request timeout", () => {
        // The two limits compound: a statement pays the wait and then the wire.
        expect(STATEMENT_WAIT_TIMEOUT_MS).toBeLessThan(
          CLICKHOUSE_REQUEST_TIMEOUT_MS,
        );
      });
    });

    describe("when a slot arrives before the wait runs out", () => {
      it("runs the statement normally", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 1,
          instance,
        });

        const first = limited.query({ query: "SELECT 1" });
        const second = limited.query({ query: "SELECT 2" });
        await settleMicrotasks();

        driver.releaseAll();
        await settleMicrotasks();
        driver.releaseAll();

        await expect(first).resolves.toEqual({ ok: true });
        await expect(second).resolves.toEqual({ ok: true });
      });
    });

    /**
     * A caller cancelling its own request is not the server being overloaded,
     * and must keep surfacing as the cancellation it is.
     */
    describe("when the caller aborts while a wait timeout is also armed", () => {
      it("still reports the abort rather than overload", async () => {
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

        await expect(abandoned).rejects.toBeInstanceOf(AcquireAbortedError);

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
        // Inserts have their own lane; command/exec/query share the read lane.
        // With 4 and a reserve of 1, one insert plus three read-lane statements
        // exactly fill the budget of 4, so a fourth read-lane statement waits.
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const inFlight = [
          limited.insert({ table: "spans", values: [] }),
          limited.command({ query: "OPTIMIZE TABLE spans" }),
          limited.exec({ query: "SELECT 1" }),
          limited.query({ query: "SELECT 2" }),
          limited.query({ query: "SELECT 3" }),
        ];
        await settleMicrotasks();

        // The insert and three read-lane statements run; the fifth has no slot
        // and waits - a write path that ignored the bound would be the one
        // that rejected live ingest.
        expect(driver.started).toBe(4);

        for (let round = 0; round < 2; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all(inFlight);
      });
    });
  });

  describe("given the insert lane is saturated", () => {
    describe("when a read is issued", () => {
      /** @scenario a saturated insert lane does not delay reads */
      it("starts the read at once", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        // 4 inserts, cap 3: three run, the fourth waits on the insert lane.
        const inserts = Array.from({ length: 4 }, () =>
          limited.insert({ table: "spans", values: [] }),
        );
        await settleMicrotasks();
        expect(driver.started).toBe(3);

        // One slot is still free - the inserts' cap stops at 3 of the 4-slot
        // budget - so a read takes it immediately.
        const read = limited.query({ query: "SELECT 1" });
        await settleMicrotasks();

        expect(driver.client.query).toHaveBeenCalledTimes(1);

        for (let round = 0; round < 4; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all([...inserts, read]);
      });

      it("keeps the surplus inserts waiting", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const inserts = Array.from({ length: 4 }, () =>
          limited.insert({ table: "spans", values: [] }),
        );
        const read = limited.query({ query: "SELECT 1" });
        await settleMicrotasks();

        expect(driver.client.insert).toHaveBeenCalledTimes(3);

        for (let round = 0; round < 4; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all([...inserts, read]);
      });
    });
  });

  describe("given the read lane is saturated", () => {
    describe("when an insert is issued", () => {
      /** @scenario a saturated read lane does not delay inserts */
      it("starts the insert at once", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const reads = Array.from({ length: 4 }, (_, index) =>
          limited.query({ query: `SELECT ${index}` }),
        );
        await settleMicrotasks();
        expect(driver.started).toBe(3);

        const insert = limited.insert({ table: "spans", values: [] });
        await settleMicrotasks();

        expect(driver.client.insert).toHaveBeenCalledTimes(1);

        for (let round = 0; round < 4; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all([...reads, insert]);
      });
    });
  });

  describe("given only reads are issued and no inserts", () => {
    describe("when more reads arrive than a fixed half-budget would allow", () => {
      /** @scenario a lone kind of work borrows the idle lane's capacity */
      it("borrows the idle insert lane's slots, keeping only its reserve", async () => {
        const driver = deferrableClient();
        // 4 with a reserve of 1: a hard half would cap reads at 2, but the read
        // lane may borrow up to 3 - everything except the inserts' one reserve.
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const reads = Array.from({ length: 3 }, (_, index) =>
          limited.query({ query: `SELECT ${index}` }),
        );
        await settleMicrotasks();

        // Three, not two: the read lane borrowed the idle insert lane's slots.
        expect(driver.started).toBe(3);

        // The inserts' reserve stayed free: an insert that arrives now starts
        // at once on the one slot held back for it.
        const insert = limited.insert({ table: "spans", values: [] });
        await settleMicrotasks();

        expect(driver.client.insert).toHaveBeenCalledTimes(1);
        expect(driver.started).toBe(4);

        for (let round = 0; round < 2; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all([...reads, insert]);
      });
    });
  });

  describe("given both lanes are saturated", () => {
    describe("when many statements of each kind are issued", () => {
      /** @scenario both lanes together never exceed the connection budget */
      it("starts no more than the whole budget", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const inFlight = [
          ...Array.from({ length: 10 }, (_, index) =>
            limited.query({ query: `SELECT ${index}` }),
          ),
          ...Array.from({ length: 10 }, () =>
            limited.insert({ table: "spans", values: [] }),
          ),
        ];
        await settleMicrotasks();

        expect(driver.started).toBe(4);

        for (let round = 0; round < 6; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all(inFlight);
      });
    });
  });

  /**
   * The refusal paths above (queue full, wait timeout, caller abort) all used a
   * budget of one, where the single shared "all" lane IS the total and nothing
   * ever waits on a cap. These exercise the same three refusals against a split
   * budget, where the read CAP fills first and the total still has a slot free —
   * so the refusal is proven to fire on the lane cap, not only on the total.
   */
  describe("given a saturated read lane cap below the total", () => {
    // 4 with a reserve of 1 caps the read lane at 3; three reads in flight
    // saturate that cap while the total still has its fourth slot free, so a
    // further read waits on the CAP and never reaches the total.
    const saturateReadCap = (limited: ClickHouseClient) =>
      Array.from({ length: 3 }, (_, index) =>
        limited.query({ query: `SELECT ${index}` }),
      );

    describe("when a further read waits past the wait bound", () => {
      /** @scenario a statement that waits too long is refused, not left waiting */
      it("refuses it as overload without reaching the driver", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
          waitTimeoutMs: 20,
        });

        const inFlight = saturateReadCap(limited);
        await settleMicrotasks();
        expect(driver.started).toBe(3);

        const waiting = limited.query({ query: "SELECT waiting" });
        await expect(waiting).rejects.toBeInstanceOf(ClickHouseOverloadedError);

        // It timed out on the read cap, not the total: the total kept its
        // fourth slot free the whole time, yet the read never ran.
        expect(driver.client.query).toHaveBeenCalledTimes(3);
        expect(driver.started).toBe(3);

        driver.releaseAll();
        await Promise.all(inFlight);
      });
    });

    describe("when the read cap's wait queue is already full", () => {
      /** @scenario an overloaded process refuses rather than queueing without limit */
      it("refuses the next read as overload", async () => {
        const driver = deferrableClient();
        // A shallow queue so the cap fills without issuing its production depth.
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
          maxQueued: 2,
        });

        const inFlight = saturateReadCap(limited);
        const queued = [
          limited.query({ query: "SELECT q0" }),
          limited.query({ query: "SELECT q1" }),
        ];
        await settleMicrotasks();

        const startedBeforeShed = driver.started;
        await expect(
          limited.query({ query: "SELECT shed" }),
        ).rejects.toBeInstanceOf(ClickHouseOverloadedError);

        // The read cap's two-deep queue was full, so the next read was shed
        // before it could reach the driver.
        expect(driver.started).toBe(startedBeforeShed);

        driver.releaseAll();
        for (let round = 0; round <= 2; round += 1) {
          await settleMicrotasks();
          driver.releaseAll();
        }
        await Promise.all([...inFlight, ...queued]);
      });
    });

    describe("when the caller abandons a read queued on the cap", () => {
      /** @scenario a caller that gives up stops waiting */
      it("reports the abort rather than overload", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const inFlight = saturateReadCap(limited);
        const controller = new AbortController();
        const abandoned = limited.query({
          query: "SELECT abandoned",
          abort_signal: controller.signal,
        });
        await settleMicrotasks();

        controller.abort();

        // Aborting a wait on the cap surfaces as the cancellation it is, never
        // relabelled as overload.
        await expect(abandoned).rejects.toBeInstanceOf(AcquireAbortedError);
        expect(driver.started).toBe(3);

        driver.releaseAll();
        await Promise.all(inFlight);
      });
    });
  });

  /**
   * The slot-availability check can only be read truthfully at the instant a
   * limiter is entered. A statement enters the total from inside its lane cap's
   * granted task, so when it is first handed to the lane cap the total's
   * occupancy is not yet the one it will face. A batch issued in one tick, each
   * still only at its lane cap, would arm no wait up front — no statement has
   * entered the total yet — and one with lane room but no total slot would then
   * queue on the total forever. The bound must be armed lazily, at the total,
   * when the total is the thing that is full.
   */
  describe("given the whole budget is taken within one tick", () => {
    describe("when a statement with lane room but no total slot follows in the same tick", () => {
      /** @scenario a same-tick statement blocked only on the total is still bounded */
      it("refuses it as overload rather than queueing on the total unbounded", async () => {
        const driver = deferrableClient();
        // 4 with a reserve of 1 caps each lane at 3. Three reads plus one insert
        // fill the total of 4, yet the insert lane still has two slots free.
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
          waitTimeoutMs: 20,
        });

        // No await between these: every statement is issued in one tick, before
        // any admission microtask has run, so the total reads zero in-flight the
        // whole time they are issued.
        const fillers = [
          limited.query({ query: "SELECT 1" }),
          limited.query({ query: "SELECT 2" }),
          limited.query({ query: "SELECT 3" }),
          limited.insert({ table: "spans", values: [] }),
        ];
        const blocked = limited.insert({ table: "spans", values: [] });

        await expect(blocked).rejects.toBeInstanceOf(ClickHouseOverloadedError);

        // Only the first insert reached the driver; the blocked one timed out on
        // the total and was shed before admission.
        expect(driver.client.insert).toHaveBeenCalledTimes(1);
        expect(driver.started).toBe(4);

        driver.releaseAll();
        for (let round = 0; round <= 1; round += 1) {
          await settleMicrotasks();
          driver.releaseAll();
        }
        await Promise.all(fillers);
      });

      it("never reaches the driver with the refused statement", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
          waitTimeoutMs: 20,
        });

        const fillers = [
          limited.query({ query: "SELECT 1" }),
          limited.query({ query: "SELECT 2" }),
          limited.query({ query: "SELECT 3" }),
          limited.insert({ table: "spans", values: [] }),
        ];
        const startedBeforeShed = driver.started;
        const blocked = limited.insert({ table: "spans", values: [] });

        await expect(blocked).rejects.toBeInstanceOf(ClickHouseOverloadedError);

        // The four fillers started, the fifth never did.
        expect(driver.started).toBe(startedBeforeShed + 4);

        driver.releaseAll();
        for (let round = 0; round <= 1; round += 1) {
          await settleMicrotasks();
          driver.releaseAll();
        }
        await Promise.all(fillers);
      });
    });

    describe("when the total was already full in an earlier tick", () => {
      /**
       * The complement of the same-tick case: lazy arming must still bound the
       * ordinary path where the total is genuinely full by the time the surplus
       * arrives. Here the lane cap grants at once and the total is what blocks.
       */
      it("refuses the lane-roomy statement as overload", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
          waitTimeoutMs: 20,
        });

        const fillers = [
          limited.query({ query: "SELECT 1" }),
          limited.query({ query: "SELECT 2" }),
          limited.query({ query: "SELECT 3" }),
          limited.insert({ table: "spans", values: [] }),
        ];
        // Let every filler be admitted so the total truly reads full before the
        // surplus insert is issued.
        await settleMicrotasks();
        expect(driver.started).toBe(4);

        const blocked = limited.insert({ table: "spans", values: [] });

        await expect(blocked).rejects.toBeInstanceOf(ClickHouseOverloadedError);

        expect(driver.client.insert).toHaveBeenCalledTimes(1);
        expect(driver.started).toBe(4);

        driver.releaseAll();
        for (let round = 0; round <= 1; round += 1) {
          await settleMicrotasks();
          driver.releaseAll();
        }
        await Promise.all(fillers);
      });
    });
  });

  describe("given a configured reserve share", () => {
    describe("when inserts flood a budget of 8 with a quarter reserved", () => {
      it("holds inserts to the budget less the reserve", async () => {
        const driver = deferrableClient();
        // 8 with a reserve share of 0.25: reserve 2, so each lane caps at 6.
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 8,
          reserveShare: 0.25,
          instance,
        });

        const inserts = Array.from({ length: 8 }, () =>
          limited.insert({ table: "spans", values: [] }),
        );
        await settleMicrotasks();

        expect(driver.started).toBe(6);

        for (let round = 0; round < 3; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all(inserts);
      });
    });
  });

  describe("given a budget of one", () => {
    describe("when a read and an insert are issued", () => {
      it("shares the single slot between them", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 1,
          instance,
        });

        const inFlight = [
          limited.insert({ table: "spans", values: [] }),
          limited.query({ query: "SELECT 1" }),
        ];
        await settleMicrotasks();

        expect(driver.started).toBe(1);

        driver.releaseAll();
        await settleMicrotasks();
        driver.releaseAll();
        await Promise.all(inFlight);
      });
    });
  });

  describe("given a saturated insert lane and metrics", () => {
    describe("when the in-flight gauge is read", () => {
      it("reports the insert lane at its bound", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const inserts = Array.from({ length: 4 }, () =>
          limited.insert({ table: "spans", values: [] }),
        );
        await settleMicrotasks();

        const { values } = await clickHouseConcurrencyMetrics.inFlight.get();
        const insertLane = values.find(
          (v) => v.labels.instance === instance && v.labels.lane === "insert",
        );

        // The insert lane caps at 3 of the 4-slot budget.
        expect(insertLane?.value).toBe(3);

        for (let round = 0; round < 4; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all(inserts);
      });

      it("reports the read lane idle", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const inserts = Array.from({ length: 4 }, () =>
          limited.insert({ table: "spans", values: [] }),
        );
        await settleMicrotasks();

        const { values } = await clickHouseConcurrencyMetrics.inFlight.get();
        const readLane = values.find(
          (v) => v.labels.instance === instance && v.labels.lane === "read",
        );

        expect(readLane?.value).toBe(0);

        for (let round = 0; round < 4; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all(inserts);
      });

      it("reports the waiting inserts as queued on the insert lane", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        const inserts = Array.from({ length: 4 }, () =>
          limited.insert({ table: "spans", values: [] }),
        );
        await settleMicrotasks();

        const { values } = await clickHouseConcurrencyMetrics.queued.get();
        const insertLane = values.find(
          (v) => v.labels.instance === instance && v.labels.lane === "insert",
        );

        // Three inserts run, the fourth waits on the insert lane.
        expect(insertLane?.value).toBe(1);

        for (let round = 0; round < 4; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all(inserts);
      });
    });

    describe("when inserts hold a lane slot but wait on the total ceiling", () => {
      it("counts them as queued on the insert lane", async () => {
        const driver = deferrableClient();
        const limited = withStatementLimit({
          client: driver.client,
          maxConcurrent: 4,
          instance,
        });

        // Three reads fill the read lane and take 3 of the 4 total slots. One
        // insert takes the last total slot; two more hold an insert-lane slot
        // but cannot run until the total ceiling frees.
        const reads = Array.from({ length: 3 }, (_, index) =>
          limited.query({ query: `SELECT ${index}` }),
        );
        const inserts = Array.from({ length: 3 }, () =>
          limited.insert({ table: "spans", values: [] }),
        );
        await settleMicrotasks();

        expect(driver.started).toBe(4);

        const { values } = await clickHouseConcurrencyMetrics.queued.get();
        const insertLane = values.find(
          (v) => v.labels.instance === instance && v.labels.lane === "insert",
        );

        // Both total-blocked inserts count as queued even though they hold an
        // insert-lane slot.
        expect(insertLane?.value).toBe(2);

        for (let round = 0; round < 4; round += 1) {
          driver.releaseAll();
          await settleMicrotasks();
        }
        await Promise.all([...reads, ...inserts]);
      });
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
  ])("given a budget of $maxConcurrent and a reserve share of $reserveShare", ({
    maxConcurrent,
    reserveShare,
    reserve,
    laneCap,
  }) => {
    describe("when the caps are computed", () => {
      it(`reserves ${reserve} and caps each lane at ${laneCap}`, () => {
        expect(statementLaneCaps({ maxConcurrent, reserveShare })).toEqual({
          reserve,
          laneCap,
        });
      });

      it("keeps a lane cap plus its reserve within the whole budget", () => {
        const caps = statementLaneCaps({ maxConcurrent, reserveShare });

        expect((caps?.laneCap ?? 0) + (caps?.reserve ?? 0)).toBe(maxConcurrent);
      });
    });
  });

  describe("given a budget of one", () => {
    describe("when the caps are computed", () => {
      it("returns null because it cannot reserve against a single slot", () => {
        expect(
          statementLaneCaps({ maxConcurrent: 1, reserveShare: 0.25 }),
        ).toBeNull();
      });
    });
  });
});
