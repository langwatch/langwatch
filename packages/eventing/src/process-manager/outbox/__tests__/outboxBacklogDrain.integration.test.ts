import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
  PrismaQueryGuard,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { PrismaProcessStore } from "../../../server/adapters/postgres/prisma-process-store";
import type { NewOutboxMessage, ProcessCommit } from "../../stores/processStore.types";
import { OutboxDispatcherService } from "../outboxDispatcherService";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for outbox backlog drain tests");
  }
  return connection.client;
}

/**
 * The issue #7016 wedge, reproduced against real Postgres leasing: a batch
 * leased up front whose sequential deliveries outlive the shared lease.
 * Before the lease hardening, the tail of every slow batch was re-leased by
 * the competing dispatcher while still queued behind the first one, the
 * superseded acknowledgements were silent zero-row updates, and the same
 * messages redelivered at attempt one forever. These tests pin the hardened
 * behavior: tails are released un-attempted, nothing is delivered twice, a
 * lapse-looping message retires, and a fenced acknowledgement is reported.
 */
const prisma = database();
const store = new PrismaProcessStore(prisma);
let processName: string;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function messages(count: number): NewOutboxMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    messageKey: `match-${String(index).padStart(3, "0")}`,
    intentType: "test.persist",
    payload: { index },
    traceCarrier: {},
  }));
}

function commit(batch: NewOutboxMessage[]): ProcessCommit<{ seeded: true }> {
  return {
    ref: { processName, projectId: "project-1", processKey: "trigger-1" },
    tenantId: "tenant-1",
    sourceEventId: "event-1",
    expectedRevision: 0,
    state: { seeded: true },
    nextWakeAt: null,
    messages: batch,
    now: Date.now(),
  };
}

describe("outbox backlog drain under slow deliveries", () => {
  beforeEach(() => {
    processName = `backlog-drain-${nanoid(10)}`;
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [
      ["processManagerOutbox", { processName, projectId: "project-1" }],
      ["processManagerInbox", { processName, projectId: "project-1" }],
      ["processManagerInstance", { processName, projectId: "project-1" }],
    ]);
  });

  describe("when two dispatchers drain a backlog whose deliveries are slow", () => {
    /** @scenario A batch running out of lease releases its tail instead of dispatching past it */
    it("releases batch tails, delivers every message exactly once, and fences nothing", async () => {
      const total = 40;
      const result = await store.commit(commit(messages(total)));
      expect(result.outcome).toBe("committed");

      const invocations = new Map<string, number>();
      // The wedge's arithmetic (10 x 16s of delivery against a 120s lease in
      // prod), sized so the outcome does not depend on timing luck:
      //   lease 1500ms, safety margin 20% = 300ms, so a delivery starts only
      //   while elapsed <= 1200ms, admitting at most 15 of them.
      // Both dispatchers therefore shed a tail even if they split the backlog
      // evenly (20 each), and the last admitted delivery still acknowledges
      // 220ms inside its lease (1200 + 80 handler vs 1500), which is the
      // headroom the Postgres round trip needs on a loaded runner.
      const handlerMs = 80;
      const makeDispatcher = () =>
        new OutboxDispatcherService({
          store,
          processNames: [processName],
          leaseDurationMs: 1_500,
          handlers: {
            "test.persist": async ({ message }) => {
              invocations.set(
                message.messageKey,
                (invocations.get(message.messageKey) ?? 0) + 1,
              );
              await sleep(handlerMs);
            },
          },
        });
      const dispatcherA = makeDispatcher();
      const dispatcherB = makeDispatcher();

      let dispatched = 0;
      let released = 0;
      let fenced = 0;
      for (let cycle = 0; cycle < 30 && dispatched < total; cycle++) {
        const reports = await Promise.all([
          dispatcherA.runOnce({ now: Date.now(), limit: total }),
          dispatcherB.runOnce({ now: Date.now(), limit: total }),
        ]);
        for (const report of reports) {
          dispatched += report.dispatched.length;
          released += report.released.length;
          fenced += report.fenced.length;
        }
      }

      expect(dispatched).toBe(total);
      // The lease budget check sheds tails instead of letting them run past
      // the lease; before the hardening this count was zero and the tail
      // messages ran concurrently on both dispatchers instead.
      expect(released).toBeGreaterThan(0);
      expect(fenced).toBe(0);
      expect(invocations.size).toBe(total);
      expect([...invocations.values()].every((count) => count === 1)).toBe(
        true,
      );
    });
  });

  describe("when a message's leases keep lapsing without acknowledgement", () => {
    /** @scenario A message that keeps lapsing its lease retires instead of retrying forever */
    it("retires it as dead without running the handler again", async () => {
      const result = await store.commit(commit(messages(1)));
      expect(result.outcome).toBe("committed");

      // Two crashed deliveries: leases taken and never acknowledged.
      for (let crash = 0; crash < 2; crash++) {
        const leased = await store.leaseDueMessages({
          now: Date.now(),
          limit: 1,
          leaseDurationMs: 20,
          processNames: [processName],
        });
        expect(leased).toHaveLength(1);
        await sleep(30);
      }

      let handlerRuns = 0;
      const dispatcher = new OutboxDispatcherService({
        store,
        processNames: [processName],
        maxAttempts: 2,
        leaseDurationMs: 250,
        handlers: {
          "test.persist": async () => {
            handlerRuns += 1;
          },
        },
      });
      const report = await dispatcher.runOnce({ now: Date.now() });

      expect(report.dead).toEqual(["match-000"]);
      expect(handlerRuns).toBe(0);
      const rows = await prisma.processManagerOutbox.findMany({
        where: { processName, projectId: "project-1" },
      });
      expect(rows[0]).toMatchObject({ status: "dead" });
    });
  });

  describe("when a delivery outlives its lease and a rival completes the message", () => {
    /** @scenario A lease-lapsed acknowledgement is counted, never silent */
    it("reports the superseded acknowledgement as fenced and leaves the row untouched", async () => {
      const result = await store.commit(commit(messages(1)));
      expect(result.outcome).toBe("committed");

      // Two facts have to hold before the rival is allowed to run: the slow
      // delivery holds the lease, and it is already past the lease-budget
      // guard so it cannot be shed un-attempted. Waiting for its handler to be
      // entered establishes both, because the guard runs before the handler
      // does. Sleeping only hopes for both, and on a loaded runner the slow
      // dispatcher can lease nothing at all or shed the message on the way to
      // the handler, either of which reports an empty `fenced`.
      let announceDeliveryStarted!: () => void;
      const deliveryStarted = new Promise<void>((resolve) => {
        announceDeliveryStarted = resolve;
      });
      let releaseGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      // Wide enough that the slow dispatcher cannot plausibly run out of lease
      // budget between leasing and its handler. Nothing waits for this to
      // expire: the lapse is produced by advancing the rival's clock.
      const leaseDurationMs = 5_000;
      const slow = new OutboxDispatcherService({
        store,
        processNames: [processName],
        leaseDurationMs,
        handlers: {
          "test.persist": () => {
            announceDeliveryStarted();
            return gate;
          },
        },
      });
      const fast = new OutboxDispatcherService({
        store,
        processNames: [processName],
        leaseDurationMs,
        handlers: { "test.persist": async () => undefined },
      });

      const slowRun = slow.runOnce({ now: Date.now() });
      // If the delivery never starts there is no race to observe, and waiting
      // on the signal alone would spend the whole 60s test timeout finding
      // that out. Racing the run against the signal turns it into an
      // assertion that names what went wrong instead. The rejection is
      // absorbed here on purpose: `slowRun` is awaited again below, which is
      // where a thrown error belongs.
      const slowRunSettled = slowRun.then(
        () => "settled without delivering" as const,
        () => "settled without delivering" as const,
      );
      const raceSetUp = await Promise.race([
        deliveryStarted.then(() => "delivery started" as const),
        slowRunSettled,
      ]);
      expect(raceSetUp).toBe("delivery started");
      // A lease is due again once `leasedUntil <= now`, and `now` is the
      // caller's, so the rival sees a lapsed lease without the test sleeping
      // through one.
      const fastReport = await fast.runOnce({
        now: Date.now() + leaseDurationMs + 1,
      });
      expect(fastReport.dispatched).toEqual(["match-000"]);

      releaseGate();
      const slowReport = await slowRun;
      expect(slowReport.fenced).toEqual(["match-000"]);
      expect(slowReport.dispatched).toEqual([]);

      const rows = await prisma.processManagerOutbox.findMany({
        where: { processName, projectId: "project-1" },
      });
      expect(rows[0]).toMatchObject({ status: "dispatched", attempts: 2 });
    });
  });
});
