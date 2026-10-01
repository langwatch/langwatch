import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The boot loop's own logic: when to run another pass, when to stop, and
 * what shutdown does. No datastore, runner or migration - timers are faked
 * since the loop waits between passes, so tests drive the clock directly.
 */
import type { MigrationPassSummary } from "../types.ts";

const stubs = vi.hoisted(() => ({
  runPass: vi.fn(),
  errors: [] as Record<string, unknown>[],
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof observabilityModule>();
  return {
    ...actual,
    createLogger: () => {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: (details: unknown) => {
          stubs.errors.push(details as Record<string, unknown>);
        },
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: () => logger,
      };
      return logger;
    },
  };
});

import type * as observabilityModule from "@langwatch/observability";

import { startSystemMigrations as start } from "../convergence.ts";

const startSystemMigrations = () => start({ runPass: stubs.runPass });

function summaryOf({ advanced }: { advanced: number }): MigrationPassSummary {
  return {
    tenantsSeen: 1,
    finalized: advanced,
    held: 0,
    parked: 0,
    skipped: 0,
    alreadyFinalized: 0,
    alreadyRolledBack: 0,
    claimed: 0,
    advanced,
  };
}

/** A held tenant re-proved and re-written `migrated`: visited, unmoved. */
function heldSummary(): MigrationPassSummary {
  return { ...summaryOf({ advanced: 0 }), held: 1, finalized: 0 };
}

/**
 * Lets the loop's awaits settle, then fires any pending timer, repeatedly -
 * so one call carries the loop through however many passes it wants before
 * the assertions run.
 */
async function drive({ cycles }: { cycles: number }): Promise<void> {
  for (let cycle = 0; cycle < cycles; cycle++) {
    await vi.advanceTimersByTimeAsync(10_000);
  }
}

describe("startSystemMigrations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    stubs.errors.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given passes that keep advancing the fleet and then stop", () => {
    describe("when the app starts", () => {
      /** @scenario "The runner drives passes until nothing advances" */
      it("runs passes until one advances nothing, then stops", async () => {
        stubs.runPass
          .mockResolvedValueOnce(summaryOf({ advanced: 4 }))
          .mockResolvedValueOnce(summaryOf({ advanced: 2 }))
          .mockResolvedValue(summaryOf({ advanced: 0 }));

        const { stop } = startSystemMigrations();
        await drive({ cycles: 6 });
        await stop();

        // Three: two that moved something, and the one that proved there was
        // nothing left. A fourth would mean the stop condition never fired.
        expect(stubs.runPass).toHaveBeenCalledTimes(3);
      });

      /** @scenario "The runner drives passes until nothing advances" */
      it("never blocks the caller on the passes", () => {
        stubs.runPass.mockResolvedValue(summaryOf({ advanced: 0 }));

        const started = startSystemMigrations();

        // Returned before any pass could have resolved: the loop is
        // background work, and boot must not wait on it.
        expect(started.stop).toBeTypeOf("function");
        expect(stubs.runPass).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a tenant that is held and never advances", () => {
    describe("when the app starts", () => {
      /** @scenario "A recurring reconciliation does not loop forever" */
      it("stops after the first pass rather than re-proving it forever", async () => {
        // The trap a terminal-based stop condition would fall into: this
        // tenant is visited and re-written `migrated` every pass, so `held`
        // is non-zero on every one of them, and it may never reach a
        // terminal state at all.
        stubs.runPass.mockResolvedValue(heldSummary());

        const { stop } = startSystemMigrations();
        await drive({ cycles: 6 });
        await stop();

        expect(stubs.runPass).toHaveBeenCalledTimes(1);
        expect(stubs.errors).toEqual([]);
      });
    });
  });

  describe("given every organization claimed by another process", () => {
    describe("when a pass advances nothing", () => {
      /** @scenario "A pass shut out by another process is not convergence" */
      it("keeps going rather than reading its own shut-out as convergence", async () => {
        // What `lease.acquire` returning false looks like in a summary - and
        // it returns false on a Redis error too, not only on real contention.
        const shutOut: MigrationPassSummary = {
          ...summaryOf({ advanced: 0 }),
          tenantsSeen: 12,
          claimed: 12,
        };
        stubs.runPass
          .mockResolvedValueOnce(shutOut)
          .mockResolvedValueOnce(shutOut)
          .mockResolvedValue(summaryOf({ advanced: 0 }));

        const { stop } = startSystemMigrations();
        await drive({ cycles: 8 });
        await stop();

        // Three: it did not stop on either shut-out pass, and stopped on the
        // one that actually got to look at the fleet.
        expect(stubs.runPass).toHaveBeenCalledTimes(3);
      });

      /** @scenario "A pass shut out by another process is not convergence" */
      it("stops when only some tenants were claimed, which is an ordinary pass", async () => {
        stubs.runPass.mockResolvedValue({
          ...summaryOf({ advanced: 0 }),
          tenantsSeen: 12,
          claimed: 11,
        });

        const { stop } = startSystemMigrations();
        await drive({ cycles: 8 });
        await stop();

        expect(stubs.runPass).toHaveBeenCalledTimes(1);
      });

      /** @scenario "A shut-out from the last remaining tenants settles once a claim has been granted" */
      it("settles once the lease store has been seen to grant this process a claim", async () => {
        // A pass enumerates only the tenants with work left, so a handful of
        // replicas booting together can genuinely hold every one of them —
        // and the granted claim is what tells that apart from a lease store
        // that answers nothing.
        stubs.runPass
          .mockResolvedValueOnce({ ...summaryOf({ advanced: 1 }), tenantsSeen: 3, claimed: 2 })
          .mockResolvedValue({ ...summaryOf({ advanced: 0 }), tenantsSeen: 2, claimed: 2 });

        const { stop } = startSystemMigrations();
        await drive({ cycles: 8 });
        await stop();

        expect(stubs.runPass).toHaveBeenCalledTimes(2);
      });

      /** @scenario "A process never granted a claim keeps trying rather than settling" */
      it("keeps trying where no pass was ever granted a claim", async () => {
        stubs.runPass.mockResolvedValue({
          ...summaryOf({ advanced: 0 }),
          tenantsSeen: 2,
          claimed: 2,
        });

        const { stop } = startSystemMigrations();
        await drive({ cycles: 30 });
        await stop();

        expect(stubs.runPass).toHaveBeenCalledTimes(25);
      });
    });
  });

  describe("given an installation with no tenants in the cohort", () => {
    describe("when a pass sees nothing at all", () => {
      /** @scenario "A pass shut out by another process is not convergence" */
      it("reads an empty fleet as converged rather than looping to the cap", async () => {
        // `claimed === tenantsSeen` holds vacuously at zero, so an empty
        // installation would loop to MAX_PASSES on every boot without this.
        stubs.runPass.mockResolvedValue({
          ...summaryOf({ advanced: 0 }),
          tenantsSeen: 0,
          claimed: 0,
        });

        const { stop } = startSystemMigrations();
        await drive({ cycles: 8 });
        await stop();

        expect(stubs.runPass).toHaveBeenCalledTimes(1);
        expect(stubs.errors).toEqual([]);
      });
    });
  });

  describe("given a pass that keeps reporting progress", () => {
    describe("when the loop reaches its maximum passes", () => {
      /**
       * @scenario "The boot chain drives the migrations to convergence before the process starts"
       */
      it("stops at the cap and logs the passes it gave up after", async () => {
        stubs.runPass.mockResolvedValue(summaryOf({ advanced: 1 }));

        const cycles = 60;
        const { stop } = startSystemMigrations();
        await drive({ cycles });
        await stop();

        const passes = stubs.runPass.mock.calls.length;
        // Fewer passes than intervals driven: the loop's own cap stopped it,
        // not the clock running out. The fake never stops reporting
        // progress, so nothing else could have.
        expect(passes).toBeGreaterThan(1);
        expect(passes).toBeLessThan(cycles);
        expect(stubs.errors).toContainEqual(expect.objectContaining({ passes }));
      });
    });
  });

  describe("given a shutdown while the loop is between passes", () => {
    describe("when stop is called", () => {
      /** @scenario "Cancelling startup stops the loop between passes" */
      it("runs no further pass and resolves without waiting out the interval", async () => {
        stubs.runPass.mockResolvedValue(summaryOf({ advanced: 1 }));

        const { stop } = startSystemMigrations();
        // Let the first pass resolve, so the loop is sitting in its wait.
        await vi.advanceTimersByTimeAsync(0);
        expect(stubs.runPass).toHaveBeenCalledTimes(1);

        // No clock advance around this at all: if the wait were not
        // abortable, `stop()` could not settle here.
        await stop();

        expect(stubs.runPass).toHaveBeenCalledTimes(1);
        // The abort is a shutdown, not a failure.
        expect(stubs.errors).toEqual([]);
      });

      /** @scenario "Cancelling startup stops the loop between passes" */
      it("passes the abort signal into every pass", () => {
        stubs.runPass.mockResolvedValue(summaryOf({ advanced: 0 }));

        startSystemMigrations();

        expect(stubs.runPass).toHaveBeenCalledWith(
          expect.objectContaining({
            signal: expect.objectContaining({ aborted: false }),
          }),
        );
      });
    });
  });

  describe("given a pass that throws", () => {
    describe("when the loop runs it", () => {
      /**
       * @scenario "The boot chain drives the migrations to convergence before the process starts"
       */
      it("stops rather than retrying against whatever is already broken", async () => {
        stubs.runPass.mockRejectedValue(new Error("state table unreachable"));

        const { stop } = startSystemMigrations();
        await drive({ cycles: 4 });
        await stop();

        expect(stubs.runPass).toHaveBeenCalledTimes(1);
        expect(stubs.errors).toContainEqual(expect.objectContaining({ pass: 1 }));
      });
    });
  });
});
