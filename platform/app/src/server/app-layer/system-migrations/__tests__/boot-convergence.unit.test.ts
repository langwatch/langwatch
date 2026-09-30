import type { MigrationPassSummary } from "@langwatch/system-migrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  runPass: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../runtime", () => ({
  runSystemMigrationPass: stubs.runPass,
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: stubs.warn,
    error: stubs.error,
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import {
  runSystemMigrationsToQuiescence,
  SystemMigrationPreflightError,
} from "../boot";

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

describe("runSystemMigrationsToQuiescence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario The runner drives passes until nothing advances */
  it("blocks until the first no-progress pass proves quiescence", async () => {
    stubs.runPass
      .mockResolvedValueOnce(summaryOf({ advanced: 4 }))
      .mockResolvedValueOnce(summaryOf({ advanced: 2 }))
      .mockResolvedValue(summaryOf({ advanced: 0 }));

    let settled = false;
    const run = runSystemMigrationsToQuiescence().then((summary) => {
      settled = true;
      return summary;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.runAllTimersAsync();
    await expect(run).resolves.toMatchObject({ advanced: 0 });
    expect(stubs.runPass).toHaveBeenCalledTimes(3);
  });

  /** @scenario A held migration stays on the legacy path without preventing startup */
  it("treats a held but unchanged tenant as quiescent", async () => {
    stubs.runPass.mockResolvedValue({
      ...summaryOf({ advanced: 0 }),
      held: 1,
      finiteHeld: 1,
    });

    await expect(runSystemMigrationsToQuiescence()).resolves.toMatchObject({
      held: 1,
    });
    expect(stubs.runPass).toHaveBeenCalledTimes(1);
  });

  /** @scenario A pass shut out by another process is not convergence */
  it("retries total claim contention but accepts an empty fleet", async () => {
    const shutOut: MigrationPassSummary = {
      ...summaryOf({ advanced: 0 }),
      tenantsSeen: 12,
      claimed: 12,
    };
    stubs.runPass
      .mockResolvedValueOnce(shutOut)
      .mockResolvedValueOnce(shutOut)
      .mockResolvedValue({
        ...summaryOf({ advanced: 0 }),
        tenantsSeen: 0,
      });

    const run = runSystemMigrationsToQuiescence();
    await vi.runAllTimersAsync();

    await expect(run).resolves.toMatchObject({ tenantsSeen: 0 });
    expect(stubs.runPass).toHaveBeenCalledTimes(3);
  });

  describe("given a pass enumerates only the tenants with work left", () => {
    describe("when a peer holds every one of the few that remain", () => {
      /** @scenario "A shut-out from the last remaining tenants settles once a claim has been granted" */
      it("starts, because a claim this process was granted proves the lease store answers", async () => {
        // The first pass claimed 35 of the 40 tenants that still had work.
        // Redis therefore answers — `acquire` fails safe to "held" on every
        // error — and the four stragglers a peer holds after that are the
        // ordinary rolling-deploy shape, not a broken lease store.
        stubs.runPass
          .mockResolvedValueOnce({
            ...summaryOf({ advanced: 3 }),
            tenantsSeen: 40,
            claimed: 5,
          })
          .mockResolvedValue({
            ...summaryOf({ advanced: 0 }),
            tenantsSeen: 4,
            claimed: 4,
          });

        const run = runSystemMigrationsToQuiescence();
        await vi.runAllTimersAsync();

        await expect(run).resolves.toMatchObject({ claimed: 4 });
        expect(stubs.runPass).toHaveBeenCalledTimes(4);
        expect(stubs.error).not.toHaveBeenCalled();
      });
    });

    describe("when no pass has ever been granted a claim", () => {
      /** @scenario "A process never granted a claim keeps trying rather than settling" */
      it("keeps trying and fails the preflight rather than calling a total shut-out settled", async () => {
        stubs.runPass.mockResolvedValue({
          ...summaryOf({ advanced: 0 }),
          tenantsSeen: 4,
          claimed: 4,
        });

        const run = runSystemMigrationsToQuiescence();
        const rejected = expect(run).rejects.toBeInstanceOf(
          SystemMigrationPreflightError,
        );
        await vi.runAllTimersAsync();

        await rejected;
        expect(stubs.runPass).toHaveBeenCalledTimes(25);
      });
    });
  });

  /** @scenario A peer's claims do not keep this process from starting */
  it("starts once it has nothing of its own left, however long a peer holds the rest", async () => {
    // Every replica runs this preflight, so on a rolling deploy each reads
    // the others' leases as claims. Waiting on them would mean waiting on
    // peers who are waiting on us, and the whole fleet crash-loops.
    stubs.runPass.mockResolvedValue({
      ...summaryOf({ advanced: 0 }),
      tenantsSeen: 7469,
      claimed: 1243,
    });

    const run = runSystemMigrationsToQuiescence();
    await vi.runAllTimersAsync();

    await expect(run).resolves.toMatchObject({ claimed: 1243 });
    expect(stubs.runPass).toHaveBeenCalledTimes(3);
    expect(stubs.error).not.toHaveBeenCalled();
    expect(stubs.warn).toHaveBeenCalledWith(
      expect.objectContaining({ passes: 3 }),
      expect.stringContaining("a peer still holds claims"),
    );
  });

  /** @scenario A momentary overlap with a peer is still waited out */
  it("waits out a peer that clears before the third pass", async () => {
    stubs.runPass
      .mockResolvedValueOnce({
        ...summaryOf({ advanced: 0 }),
        tenantsSeen: 7469,
        claimed: 1243,
      })
      .mockResolvedValue({ ...summaryOf({ advanced: 0 }), tenantsSeen: 7469 });

    const run = runSystemMigrationsToQuiescence();
    await vi.runAllTimersAsync();

    await expect(run).resolves.toMatchObject({ claimed: 0 });
    expect(stubs.runPass).toHaveBeenCalledTimes(2);
    expect(stubs.warn).not.toHaveBeenCalled();
  });

  it("retries when even one tenant outcome is hidden by a concurrent claim", async () => {
    stubs.runPass
      .mockResolvedValueOnce({
        ...summaryOf({ advanced: 0 }),
        tenantsSeen: 12,
        claimed: 1,
      })
      .mockResolvedValue(summaryOf({ advanced: 0 }));
    const run = runSystemMigrationsToQuiescence();
    await vi.runAllTimersAsync();
    await expect(run).resolves.toMatchObject({ claimed: 0 });
    expect(stubs.runPass).toHaveBeenCalledTimes(2);
  });

  /** @scenario One tenant's parked migration does not stop the fleet starting */
  it("lets the fleet start when one tenant's migration parks", async () => {
    // A park is one tenant's migration throwing. Its gate stays shut, so it
    // is served exactly as it was before the identity branch existed —
    // refusing every pod in the fleet for it bought nothing, and cost the
    // scale-up needed to clear whatever caused the park.
    stubs.runPass.mockResolvedValue({
      ...summaryOf({ advanced: 0 }),
      parked: 1,
    });

    await expect(runSystemMigrationsToQuiescence()).resolves.toMatchObject({
      parked: 1,
    });
  });

  it("waits for queue effects and propagates barrier failures", async () => {
    const failure = new Error("blocked subscriber group");
    stubs.runPass.mockResolvedValue(summaryOf({ advanced: 0 }));
    await expect(
      runSystemMigrationsToQuiescence({
        awaitPassEffects: async () => {
          throw failure;
        },
      }),
    ).rejects.toMatchObject({ cause: failure });
  });

  /** @scenario A loop that never converges prevents startup */
  it("rejects after the pass cap", async () => {
    stubs.runPass.mockResolvedValue(summaryOf({ advanced: 1 }));

    const run = runSystemMigrationsToQuiescence();
    const rejected = expect(run).rejects.toBeInstanceOf(
      SystemMigrationPreflightError,
    );
    await vi.runAllTimersAsync();

    await rejected;
    expect(stubs.runPass).toHaveBeenCalledTimes(25);
    expect(stubs.error).toHaveBeenCalledWith(
      { passes: 25 },
      expect.stringContaining("after 25 passes"),
    );
  });

  /** @scenario A failed pass prevents startup */
  it("rejects immediately with the runner failure as its cause", async () => {
    const cause = new Error("state table unreachable");
    stubs.runPass.mockRejectedValue(cause);

    await expect(runSystemMigrationsToQuiescence()).rejects.toMatchObject({
      name: "SystemMigrationPreflightError",
      cause,
    });
    expect(stubs.runPass).toHaveBeenCalledTimes(1);
  });

  /** @scenario "Cancelling startup stops the loop between passes" */
  it("rejects an abort between passes without starting another pass", async () => {
    stubs.runPass.mockResolvedValue(summaryOf({ advanced: 1 }));
    const controller = new AbortController();
    const run = runSystemMigrationsToQuiescence({ signal: controller.signal });
    const rejected = expect(run).rejects.toMatchObject({ name: "AbortError" });

    await vi.advanceTimersByTimeAsync(0);
    expect(stubs.runPass).toHaveBeenCalledTimes(1);
    controller.abort();

    await rejected;
    expect(stubs.runPass).toHaveBeenCalledTimes(1);
  });
});
