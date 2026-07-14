/**
 * @vitest-environment node
 *
 * Integration tests for the ADR-044 Phase 1 scheduler primitive against REAL
 * Postgres (`ScheduledJob`) — NO Redis. These prove the correctness core the
 * ADR flags as riskiest — a slot fires exactly once across two concurrent
 * "pods", the loop reacts promptly to a freshly-inserted job, and a throwing
 * handler cannot kill the loop — by EXECUTING the code path, not asserting on
 * strings.
 */
import { randomUUID } from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { createLogger } from "@langwatch/observability";
import { getTestProject } from "~/utils/testUtils";
import { PrismaScheduledJobRepository } from "../scheduled-job.repository";
import { SchedulerRegistry } from "../scheduler.registry";
import { SchedulerService } from "../scheduler.service";
import type { ScheduledJobFire } from "../scheduler.types";

const logger = createLogger("test:scheduler-integration");
const repo = new PrismaScheduledJobRepository(prisma);

let projectId: string;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(20);
  }
  throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`);
}

function makeService({
  registry,
  maxSleepMs,
}: {
  registry: SchedulerRegistry;
  maxSleepMs: number;
}): SchedulerService {
  return new SchedulerService({
    repo,
    registry,
    processRole: "worker",
    logger,
    maxSleepMs,
  });
}

beforeAll(async () => {
  const project = await getTestProject("scheduler-integration");
  projectId = project.id;
});

afterEach(async () => {
  await prisma.scheduledJob.deleteMany({ where: { projectId } });
});

afterAll(async () => {
  await prisma.scheduledJob.deleteMany({ where: { projectId } });
});

describe("SchedulerService (real Postgres, no Redis)", () => {
  describe("given a due job and two scheduler instances (two simulated pods)", () => {
    describe("when both run a cycle over the same due row", () => {
      it("fires the handler exactly once and advances nextRunAt", async () => {
        const fires: ScheduledJobFire[] = [];
        const handler = async (fire: ScheduledJobFire): Promise<void> => {
          fires.push(fire);
        };

        const slot = new Date(Date.now() - 1_000); // already due
        const targetId = `once-${randomUUID()}`;
        await prisma.scheduledJob.create({
          data: {
            projectId,
            targetType: "test-once",
            targetId,
            // Hourly, not every-minute: the delivered-fire advance is
            // `computeNextRunAt(after: slot)`, so a coarse cron keeps the next
            // instant unambiguously in the future (the next top-of-hour after a
            // ~1s-old slot) and the row can't immediately re-fire a catch-up
            // slot — which would race the strict exactly-once assertion below.
            cron: "0 * * * *",
            timezone: "UTC",
            nextRunAt: slot,
          },
        });

        const registryA = new SchedulerRegistry();
        registryA.register({ targetType: "test-once", handler });
        const registryB = new SchedulerRegistry();
        registryB.register({ targetType: "test-once", handler });

        const a = makeService({ registry: registryA, maxSleepMs: 200 });
        const b = makeService({ registry: registryB, maxSleepMs: 200 });

        a.start();
        b.start();
        try {
          await waitFor(() => fires.length >= 1, 4_000);
          // Give the loser several cycles to (wrongly) double-fire.
          await sleep(700);
        } finally {
          await a.stop();
          await b.stop();
        }

        // Exactly-once: the per-row conditional claim guarantees it even
        // though BOTH workers scan and race the same due row.
        expect(fires).toHaveLength(1);
        expect(fires[0]?.targetId).toBe(targetId);
        expect(fires[0]?.slot.getTime()).toBe(slot.getTime());

        // nextRunAt advanced past the fired slot; lastSlot records the fire.
        const row = await prisma.scheduledJob.findFirst({
          where: { projectId, targetId },
        });
        expect(row?.nextRunAt.getTime()).toBeGreaterThan(slot.getTime());
        expect(row?.lastSlot?.getTime()).toBe(slot.getTime());
      });
    });
  });

  describe("given a running loop and a freshly-inserted due job", () => {
    describe("when wake() is poked after the insert", () => {
      it("reacts and fires promptly without waiting out maxSleep", async () => {
        const maxSleepMs = 5_000; // large: a non-woken loop would wait ~this long
        const fires: ScheduledJobFire[] = [];
        const registry = new SchedulerRegistry();
        registry.register({
          targetType: "test-wake",
          handler: async (fire) => {
            fires.push(fire);
          },
        });

        const svc = makeService({ registry, maxSleepMs });
        svc.start();
        try {
          // Let the loop enter its long sleep (no jobs yet → sleeps ~maxSleep).
          await sleep(250);

          const slot = new Date(Date.now() - 100);
          await prisma.scheduledJob.create({
            data: {
              projectId,
              targetType: "test-wake",
              targetId: `wake-${randomUUID()}`,
              cron: "* * * * *",
              timezone: "UTC",
              nextRunAt: slot,
            },
          });

          const wokeAt = Date.now();
          svc.wake(); // in-process wake interrupts the sleep for an immediate re-scan
          await waitFor(() => fires.length >= 1, 3_000);
          const elapsed = Date.now() - wokeAt;

          expect(fires).toHaveLength(1);
          // It fired promptly after the wake — far under maxSleep (5s). Loose
          // bound to tolerate slow CI while still proving it did not wait out
          // the backstop.
          expect(elapsed).toBeLessThan(2_500);
        } finally {
          await svc.stop();
        }
      });
    });
  });

  describe("given two due jobs where the first handler throws", () => {
    describe("when the loop fires them in one cycle", () => {
      it("keeps going and still fires the second job", async () => {
        const goodFires: string[] = [];
        const registry = new SchedulerRegistry();
        registry.register({
          targetType: "test-throw-bad",
          handler: async () => {
            throw new Error("boom");
          },
        });
        registry.register({
          targetType: "test-throw-good",
          handler: async (fire) => {
            goodFires.push(fire.targetId);
          },
        });

        // Bad slot is earlier → scanned first (findDue orders by nextRunAt asc).
        await prisma.scheduledJob.create({
          data: {
            projectId,
            targetType: "test-throw-bad",
            targetId: "throw-bad-1",
            cron: "* * * * *",
            timezone: "UTC",
            nextRunAt: new Date(Date.now() - 2_000),
          },
        });
        await prisma.scheduledJob.create({
          data: {
            projectId,
            targetType: "test-throw-good",
            targetId: "throw-good-1",
            cron: "* * * * *",
            timezone: "UTC",
            nextRunAt: new Date(Date.now() - 1_000),
          },
        });

        const svc = makeService({ registry, maxSleepMs: 200 });
        svc.start();
        try {
          await waitFor(() => goodFires.includes("throw-good-1"), 4_000);
        } finally {
          await svc.stop();
        }

        expect(goodFires).toContain("throw-good-1");
      });
    });
  });

  describe("given a single due row and two racing claims (the exactly-once core)", () => {
    describe("when both workers claim the same slot concurrently", () => {
      it("lets exactly one win the conditional claim", async () => {
        const slot = new Date(Date.now() - 1_000);
        const targetId = `race-${randomUUID()}`;
        const created = await prisma.scheduledJob.create({
          data: {
            projectId,
            targetType: "test-race",
            targetId,
            cron: "* * * * *",
            timezone: "UTC",
            nextRunAt: slot,
          },
        });

        const [won1, won2] = await Promise.all([
          repo.claim({
            id: created.id,
            projectId,
            expectedNextRunAt: slot,
            slot,
            leaseUntil: new Date(Date.now() + 60_000),
          }),
          repo.claim({
            id: created.id,
            projectId,
            expectedNextRunAt: slot,
            slot,
            leaseUntil: new Date(Date.now() + 120_000),
          }),
        ]);

        expect([won1, won2].filter(Boolean)).toHaveLength(1);
      });
    });
  });
});
