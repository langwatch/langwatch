import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "~/utils/logger/server";
import { computeNextRunAt } from "../nextRunAt";
import { SchedulerRegistry } from "../scheduler.registry";
import { SchedulerService } from "../scheduler.service";
import type {
  ScheduledJobRecord,
  ScheduledJobRepository,
} from "../scheduler.types";

// The abandon path must be OBSERVABLE — assert captureException fires.
const captureException = vi.fn();
vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

/**
 * Regression coverage for the ADR-044 P1 (scheduler.service.ts:337): a claim
 * used to advance `nextRunAt` to the NEXT cron slot and stamp `lastSlot` BEFORE
 * the handler ran, so a transient handler failure PERMANENTLY skipped that
 * calendar slot. These tests EXECUTE the real loop against a mock repository and
 * assert the lease-and-retry contract:
 *   - a first-attempt failure retries the SAME slot (near-future backoff,
 *     `lastSlot` NOT advanced, attempts bumped, lastError recorded);
 *   - only after MAX_ATTEMPTS is the slot abandoned to the next cron instant,
 *     and that abandon is observable (logger.error + captureException);
 *   - a delivered fire advances the calendar and stamps `lastSlot`;
 *   - an unknown handler releases the lease to the next slot without retrying.
 */

const CRON = "0 9 * * 1"; // Mondays 09:00 — next instant is always far future
const TZ = "UTC";
const SLOT = new Date("2026-07-13T09:00:00.000Z"); // a Monday 09:00
const NEXT_CRON = computeNextRunAt({ cron: CRON, timezone: TZ, after: SLOT });

function makeLogger(): { logger: Logger; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error,
  } as unknown as Logger;
  return { logger, error };
}

function makeJob(overrides: Partial<ScheduledJobRecord> = {}): ScheduledJobRecord {
  return {
    id: "job-1",
    projectId: "project-1",
    targetType: "reportTrigger",
    targetId: "trigger-1",
    cron: CRON,
    timezone: TZ,
    nextRunAt: SLOT,
    lastSlot: null,
    currentSlot: null,
    attempts: 0,
    lastError: null,
    active: true,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

/**
 * A mock repo that hands the loop `job` exactly once, then drains. `claim`
 * always wins (single worker), `settleClaim` records what the policy decided.
 */
function makeRepo(job: ScheduledJobRecord): {
  repo: ScheduledJobRepository;
  settleClaim: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
} {
  let dueServed = false;
  let earliestServed = false;
  const settleClaim = vi.fn(async () => true);
  const claim = vi.fn(async () => true);
  const repo: ScheduledJobRepository = {
    findDue: vi.fn(async () => {
      if (dueServed) return [];
      dueServed = true;
      return [job];
    }),
    earliestActiveNextRunAt: vi.fn(async () => {
      // Past on the first peek (scan immediately), then null so the loop sinks
      // into its backstop sleep instead of hot-spinning after the one fire.
      if (earliestServed) return null;
      earliestServed = true;
      return new Date(Date.now() - 1_000);
    }),
    claim,
    settleClaim,
    upsertForTarget: vi.fn(async () => undefined),
    deactivateForTarget: vi.fn(async () => undefined),
    findAllForProject: vi.fn(async () => []),
    listForOps: vi.fn(async () => []),
  };
  return { repo, settleClaim, claim };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waitFor: predicate not satisfied within ${timeoutMs}ms`);
}

/** Drive the loop until `settleClaim` fires once, then stop. */
async function runOneFire({
  job,
  handler,
  registerHandler = true,
  logger,
}: {
  job: ScheduledJobRecord;
  handler: (fire: unknown) => Promise<void>;
  registerHandler?: boolean;
  logger: Logger;
}): Promise<{
  settleClaim: ReturnType<typeof vi.fn>;
  handlerCalls: number;
}> {
  const { repo, settleClaim } = makeRepo(job);
  const registry = new SchedulerRegistry();
  const wrapped = vi.fn(handler);
  if (registerHandler) {
    registry.register({ targetType: job.targetType, handler: wrapped });
  }
  const svc = new SchedulerService({
    repo,
    registry,
    processRole: "worker",
    logger,
    maxSleepMs: 5_000,
  });
  svc.start();
  try {
    await waitFor(() => settleClaim.mock.calls.length >= 1);
  } finally {
    await svc.stop();
  }
  return { settleClaim, handlerCalls: wrapped.mock.calls.length };
}

afterEach(() => {
  captureException.mockClear();
});

describe("SchedulerService lease-and-retry (ADR-044 P1)", () => {
  describe("given a fresh slot whose handler throws on the first attempt", () => {
    describe("when the loop fires it", () => {
      it("retries the SAME slot: near-future backoff, lastSlot NOT advanced, attempts bumped, error recorded", async () => {
        const { logger } = makeLogger();
        const job = makeJob({ attempts: 0, lastSlot: null });
        const { settleClaim, handlerCalls } = await runOneFire({
          job,
          logger,
          handler: async () => {
            throw new Error("transient provider 503");
          },
        });

        // The handler actually ran (the path is executed, not string-asserted).
        expect(handlerCalls).toBe(1);

        const settle = settleClaim.mock.calls[0]![0] as {
          nextRunAt: Date;
          lastSlot: Date | null;
          attempts: number;
          lastError: string | null;
        };

        // Retried, NOT abandoned: the calendar did NOT jump to the next cron
        // instant — it re-armed a near-future backoff instead.
        expect(settle.nextRunAt.getTime()).not.toBe(NEXT_CRON.getTime());
        expect(settle.nextRunAt.getTime()).toBeLessThan(Date.now() + 5 * 60_000);
        expect(settle.nextRunAt.getTime()).toBeGreaterThan(Date.now() - 1_000);

        // lastSlot NOT advanced past the slot → the slot is still "undelivered".
        expect(settle.lastSlot).toBeNull();

        expect(settle.attempts).toBe(1);
        expect(settle.lastError).toContain("transient provider 503");
      });
    });
  });

  describe("given a slot already at the final attempt whose handler throws", () => {
    describe("when the loop fires it", () => {
      it("abandons the slot to the next cron instant, observably (lastError kept, logger.error + captureException)", async () => {
        const { logger, error } = makeLogger();
        // attempts=4 so attempts+1=5 hits MAX_ATTEMPTS → abandon, not retry.
        const job = makeJob({ attempts: 4, lastSlot: null });
        const { settleClaim } = await runOneFire({
          job,
          logger,
          handler: async () => {
            throw new Error("still broken");
          },
        });

        const settle = settleClaim.mock.calls[0]![0] as {
          nextRunAt: Date;
          lastSlot: Date | null;
          attempts: number;
          lastError: string | null;
        };

        // Abandoned: the schedule moves on to the next cron instant so it can't
        // wedge — but lastSlot stays null (the slot was NEVER delivered).
        expect(settle.nextRunAt.getTime()).toBe(NEXT_CRON.getTime());
        expect(settle.lastSlot).toBeNull();
        expect(settle.attempts).toBe(0); // reset for the next slot
        expect(settle.lastError).toContain("still broken"); // kept for the operator

        // Observable, never silently lost.
        expect(error).toHaveBeenCalled();
        const abandonLog = error.mock.calls.find((c) =>
          String(c[1]).includes("abandoned after max attempts"),
        );
        expect(abandonLog).toBeDefined();
        const abandonCapture = captureException.mock.calls.find(
          (c) =>
            (c[1] as { extra?: { phase?: string } })?.extra?.phase ===
            "scheduler-abandon",
        );
        expect(abandonCapture).toBeDefined();
      });
    });
  });

  describe("given a slot whose handler succeeds", () => {
    describe("when the loop fires it", () => {
      it("advances to the next cron instant and stamps lastSlot as delivered", async () => {
        const { logger } = makeLogger();
        const job = makeJob({ attempts: 2, lastSlot: null });
        const { settleClaim } = await runOneFire({
          job,
          logger,
          handler: async () => {
            // delivered
          },
        });

        const settle = settleClaim.mock.calls[0]![0] as {
          nextRunAt: Date;
          lastSlot: Date | null;
          attempts: number;
          lastError: string | null;
        };

        expect(settle.nextRunAt.getTime()).toBe(NEXT_CRON.getTime());
        expect(settle.lastSlot?.getTime()).toBe(SLOT.getTime()); // DELIVERED
        expect(settle.attempts).toBe(0); // retry state cleared
        expect(settle.lastError).toBeNull();
      });
    });
  });

  describe("given a fresh slot whose handler throws", () => {
    describe("when the retry policy settles", () => {
      it("pins the calendar slot in currentSlot so the retry re-fires the same instant", async () => {
        const { logger } = makeLogger();
        const job = makeJob({ attempts: 0 });
        const { settleClaim } = await runOneFire({
          job,
          logger,
          handler: async () => {
            throw new Error("transient provider 503");
          },
        });

        const settle = settleClaim.mock.calls[0]![0] as {
          currentSlot: Date | null;
        };
        expect(settle.currentSlot?.getTime()).toBe(SLOT.getTime());
      });
    });
  });

  describe("given a retry wake whose nextRunAt is the backoff instant", () => {
    describe("when the loop re-fires it", () => {
      it("hands the handler the ORIGINAL cron slot, not the backoff instant, and stamps lastSlot with it on success", async () => {
        const { logger } = makeLogger();
        // The first attempt failed at SLOT; the retry settle re-armed
        // nextRunAt at a one-minute backoff and pinned currentSlot = SLOT.
        // Without the pin, this fire would compute its slot — and hence a
        // daily report's window — from the backoff instant (minutes, not a
        // day) and stamp lastSlot with it.
        const backoffAt = new Date(SLOT.getTime() + 60_000);
        const job = makeJob({
          attempts: 1,
          nextRunAt: backoffAt,
          currentSlot: SLOT,
          lastError: "transient provider 503",
        });
        const fires: { slot: Date }[] = [];
        const { settleClaim } = await runOneFire({
          job,
          logger,
          handler: async (fire) => {
            fires.push(fire as { slot: Date });
          },
        });

        expect(fires).toHaveLength(1);
        expect(fires[0]!.slot.getTime()).toBe(SLOT.getTime());

        const settle = settleClaim.mock.calls[0]![0] as {
          nextRunAt: Date;
          lastSlot: Date | null;
          currentSlot: Date | null;
          attempts: number;
        };
        // Delivered: the calendar marker is the ORIGINAL slot, the pin is
        // cleared, and the calendar advances from the slot (not the backoff).
        expect(settle.lastSlot?.getTime()).toBe(SLOT.getTime());
        expect(settle.currentSlot).toBeNull();
        expect(settle.nextRunAt.getTime()).toBe(NEXT_CRON.getTime());
        expect(settle.attempts).toBe(0);
      });
    });
  });

  describe("given a slot whose targetType has no registered handler", () => {
    describe("when the loop fires it", () => {
      it("releases the lease to the next cron instant without advancing lastSlot", async () => {
        const { logger } = makeLogger();
        const job = makeJob({ attempts: 0, lastSlot: SLOT });
        const { settleClaim, handlerCalls } = await runOneFire({
          job,
          logger,
          registerHandler: false,
          handler: async () => {
            throw new Error("should never run");
          },
        });

        expect(handlerCalls).toBe(0); // nothing to run

        const settle = settleClaim.mock.calls[0]![0] as {
          nextRunAt: Date;
          lastSlot: Date | null;
          attempts: number;
          lastError: string | null;
        };

        // Released to the next cron instant (nothing to retry), lastSlot left
        // exactly as it was (unchanged, still the prior delivered slot).
        expect(settle.nextRunAt.getTime()).toBe(NEXT_CRON.getTime());
        expect(settle.lastSlot?.getTime()).toBe(SLOT.getTime());
        expect(settle.attempts).toBe(0);
        expect(settle.lastError).toBeNull();
      });
    });
  });
});
