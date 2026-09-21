import type { Logger } from "@langwatch/observability";
import type { MigrationPassSummary } from "@langwatch/system-migrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProcessRole } from "../config";
import { SystemMigrationRedriveService } from "../redrive";

const INTERVAL_MS = 60_000;

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  } as unknown as Logger;
}

function summaryOf(
  overrides: Partial<MigrationPassSummary> = {},
): MigrationPassSummary {
  return {
    tenantsSeen: 1,
    finalized: 0,
    held: 0,
    parked: 0,
    skipped: 0,
    alreadyFinalized: 0,
    alreadyRolledBack: 0,
    claimed: 0,
    advanced: 0,
    ...overrides,
  };
}

function startRedrive({
  hasWork = true,
  runPass = vi.fn().mockResolvedValue(summaryOf()),
  processRole = "worker" as ProcessRole,
}: {
  hasWork?: boolean | (() => Promise<boolean>);
  runPass?: () => Promise<MigrationPassSummary>;
  processRole?: ProcessRole;
} = {}) {
  const hasTenantAwaitingRedrive = vi.fn(
    typeof hasWork === "function" ? hasWork : async () => hasWork,
  );
  const service = new SystemMigrationRedriveService({
    hasTenantAwaitingRedrive,
    runPass,
    processRole,
    logger: makeLogger(),
    intervalMs: INTERVAL_MS,
  });
  service.start();
  return { service, hasTenantAwaitingRedrive, runPass };
}

describe("SystemMigrationRedriveService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a tenant parked after startup had already finished", () => {
    /** @scenario "A worker re-drives a parked tenant without being asked" */
    it("drives a pass on every cadence, and a repeated park changes nothing", async () => {
      // `advanced: 0` with `parked: 1` is exactly the permanently broken
      // tenant: the runner does not count a repeated park as an advance. The
      // cadence must keep going anyway — it converges on nothing.
      const runPass = vi.fn().mockResolvedValue(summaryOf({ parked: 1 }));
      const { service } = startRedrive({ runPass });

      expect(runPass).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(runPass).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(runPass).toHaveBeenCalledTimes(2);

      await service.stop();
    });

    /** @scenario "A recurring reconciliation keeps running on a long-lived worker" */
    it("drives a pass for a held tenant too", async () => {
      // A recurring reconciliation never finalizes: it writes `migrated` on
      // every pass forever, which is what keeps the gate open and gives it
      // the cadence it was declared to need.
      const runPass = vi.fn().mockResolvedValue(summaryOf({ held: 1 }));
      const { service, hasTenantAwaitingRedrive } = startRedrive({ runPass });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);

      expect(hasTenantAwaitingRedrive).toHaveBeenCalledTimes(1);
      expect(runPass).toHaveBeenCalledTimes(1);

      await service.stop();
    });
  });

  describe("given every tenant is finalized or pinned to its legacy path", () => {
    /** @scenario "A fleet with nothing to re-drive does not sweep" */
    it("asks the stored state and runs no pass", async () => {
      const { service, hasTenantAwaitingRedrive, runPass } = startRedrive({
        hasWork: false,
      });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

      expect(hasTenantAwaitingRedrive).toHaveBeenCalledTimes(3);
      expect(runPass).not.toHaveBeenCalled();

      await service.stop();
    });
  });

  describe("given a process that does not run the worker stack", () => {
    /** @scenario "Only a worker re-drives" */
    it("never starts a cadence in the api process", async () => {
      const { service, hasTenantAwaitingRedrive, runPass } = startRedrive({
        processRole: "web",
      });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

      expect(hasTenantAwaitingRedrive).not.toHaveBeenCalled();
      expect(runPass).not.toHaveBeenCalled();

      await service.stop();
    });

    it("never starts a cadence in the one-shot migration task", async () => {
      const { service, runPass } = startRedrive({ processRole: "migration" });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5);

      expect(runPass).not.toHaveBeenCalled();

      await service.stop();
    });
  });

  describe("given a pass that fails outright after startup", () => {
    /** @scenario "A re-drive that fails does not end the cadence" */
    it("backs off and attempts another pass", async () => {
      const runPass = vi
        .fn()
        .mockRejectedValueOnce(new Error("state table unreachable"))
        .mockResolvedValue(summaryOf());
      const { service } = startRedrive({ runPass });

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(runPass).toHaveBeenCalledTimes(1);

      // The backoff sits between the failure and the next cadence, so the
      // loop is still alive rather than having unwound on the rejection.
      await vi.advanceTimersByTimeAsync(5 * 60_000 + INTERVAL_MS);
      expect(runPass).toHaveBeenCalledTimes(2);

      await service.stop();
    });
  });

  describe("when the worker shuts down", () => {
    it("stops the cadence", async () => {
      const { service, runPass } = startRedrive();

      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(runPass).toHaveBeenCalledTimes(1);

      await service.stop();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);

      expect(runPass).toHaveBeenCalledTimes(1);
    });
  });
});
