import type { MigrationPassSummary } from "@langwatch/system-migrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  runPass: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../runtime", () => ({
  runSystemMigrationPass: stubs.runPass,
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
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

  /** @scenario A held tenant that never advances does not loop forever */
  it("treats a held but unchanged tenant as quiescent", async () => {
    stubs.runPass.mockResolvedValue({
      ...summaryOf({ advanced: 0 }),
      held: 1,
      finiteHeld: 0,
    });

    await expect(runSystemMigrationsToQuiescence()).resolves.toMatchObject({
      held: 1,
    });
    expect(stubs.runPass).toHaveBeenCalledTimes(1);
  });

  it("rejects finite held work that cannot converge", async () => {
    stubs.runPass.mockResolvedValue({
      ...summaryOf({ advanced: 0 }),
      held: 1,
      finiteHeld: 1,
    });
    await expect(runSystemMigrationsToQuiescence()).rejects.toThrow(
      "finite migrations held",
    );
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

  it("rejects a parked tenant at the startup boundary", async () => {
    stubs.runPass.mockResolvedValue({
      ...summaryOf({ advanced: 0 }),
      parked: 1,
    });
    await expect(runSystemMigrationsToQuiescence()).rejects.toThrow("parked 1");
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
