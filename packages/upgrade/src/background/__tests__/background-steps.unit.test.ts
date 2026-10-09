/**
 * A paused worker runs nothing; a stopped or failing step stays resumable; the lease renews on a
 * timer. Spec: specs/upgrade/background-steps.feature.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpgradeStep } from "../../ledger.ts";
import { defineMigrationStep, type MigrationStepRun } from "../../step/migration-step.ts";
import {
  type BackgroundStepsLedger,
  type BackgroundStepsLog,
  BackgroundStepsService,
} from "../background-steps.service.ts";

const refuse = (): never => {
  throw new Error("a paused worker writes nothing");
};

describe("BackgroundStepsService", () => {
  describe("given a worker whose gate stopped serving", () => {
    /** @scenario "A worker that stopped serving runs no background step" */
    it("runs no step and reports the pass paused", async () => {
      let runs = 0;
      const ledger: BackgroundStepsLedger = {
        findSteps: async () => [
          { id: "identity:reopen-unproven-accounts", status: "pending", report: null },
        ],
        acquireLease: refuse,
        renewLease: refuse,
        releaseLease: refuse,
        markRunning: refuse,
        setStatus: refuse,
        saveReport: refuse,
      };
      const service = BackgroundStepsService.create({
        ledger,
        steps: [
          defineMigrationStep({
            id: "identity:reopen-unproven-accounts",
            kind: "data",
            mode: "background",
            description: "Reopens accounts that never proved their address.",
            run: async () => ({ runs: ++runs }),
          }),
        ],
        serving: () => false,
        oldWritersGoneFor: async () => true,
        identity: { owner: "worker-1", image: "3.21.0", host: "host" },
        log: () => undefined,
      });

      const sweep = await service.sweep({ signal: new AbortController().signal });

      expect(sweep).toEqual({ paused: true, ran: [], failed: [], waiting: [], retrying: [] });
      expect(runs).toBe(0);
    });
  });

  describe("given a step another worker finished between the read and the lease", () => {
    /** @scenario "A step another worker finished while this one took the lease does not run again" */
    it("does not run it, mark it running or keep its lease", async () => {
      let runs = 0;
      let reads = 0;
      const released: string[] = [];
      const ledger: BackgroundStepsLedger = {
        findSteps: async () => [
          {
            id: "identity:reopen-unproven-accounts",
            status: reads++ === 0 ? "pending" : "done",
            report: null,
          },
        ],
        acquireLease: async () => ({}),
        renewLease: refuse,
        releaseLease: async ({ name }) => (released.push(name), true),
        markRunning: refuse,
        setStatus: refuse,
        saveReport: refuse,
      };
      const service = BackgroundStepsService.create({
        ledger,
        steps: [
          defineMigrationStep({
            id: "identity:reopen-unproven-accounts",
            kind: "data",
            mode: "background",
            description: "Reopens accounts that never proved their address.",
            run: async () => ({ runs: ++runs }),
          }),
        ],
        serving: () => true,
        oldWritersGoneFor: async () => true,
        identity: { owner: "worker-1", image: "3.21.0", host: "host" },
        log: () => undefined,
      });

      const sweep = await service.sweep({ signal: new AbortController().signal });

      expect(sweep).toEqual({ paused: false, ran: [], failed: [], waiting: [], retrying: [] });
      expect(runs).toBe(0);
      expect(released).toEqual(["background:identity:reopen-unproven-accounts"]);
    });
  });
});

const STEP = "identity:reopen-unproven-accounts";
type Row = Pick<UpgradeStep, "id" | "status" | "report" | "lastError">;

/** The step table and one lease in memory, as the two upgrade repositories keep them. */
class MemoryBackgroundLedger implements BackgroundStepsLedger {
  row: Row = { id: STEP, status: "pending", report: null, lastError: null };
  leaseOwner: string | null = null;
  renewals = 0;
  refuseRenewals = false;

  findSteps = async () => [{ ...this.row }];
  acquireLease = async ({ owner }: { owner: string }) => {
    if (this.leaseOwner) return null;
    this.leaseOwner = owner;
    return {};
  };
  renewLease = async ({ owner }: { owner: string }) => {
    this.renewals += 1;
    if (this.refuseRenewals) this.leaseOwner = "worker-2";
    return this.leaseOwner === owner ? {} : null;
  };
  releaseLease = async ({ owner }: { owner: string }) => {
    if (this.leaseOwner !== owner) return false;
    this.leaseOwner = null;
    return true;
  };
  markRunning = async () => {
    this.row = { ...this.row, status: "running" };
  };
  setStatus: BackgroundStepsLedger["setStatus"] = async ({ status, lastError, report }) => {
    this.row = {
      ...this.row,
      status,
      lastError: lastError ?? null,
      report: report ?? this.row.report,
    };
  };
  saveReport = async ({ report }: { report: Record<string, unknown> }) => {
    this.row = { ...this.row, report };
  };
}

function serviceOver({
  ledger,
  run,
  log = () => undefined,
  clock = { now: 0 },
}: {
  ledger: MemoryBackgroundLedger;
  run: MigrationStepRun;
  log?: BackgroundStepsLog;
  clock?: { now: number };
}) {
  return BackgroundStepsService.create({
    ledger,
    steps: [
      defineMigrationStep({
        id: STEP,
        kind: "data",
        mode: "background",
        description: "Reopens accounts that never proved their address.",
        run,
      }),
    ],
    serving: () => true,
    oldWritersGoneFor: async () => true,
    identity: { owner: "worker-1", image: "3.21.0", host: "host" },
    log,
    renewEveryMs: 1_000,
    retry: { attempts: 3, firstBackoffMs: 60_000, maxBackoffMs: 600_000 },
    now: () => clock.now,
  });
}

const sweepOnce = (service: BackgroundStepsService, signal = new AbortController().signal) =>
  service.sweep({ signal });

describe("BackgroundStepsService runs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a step that throws once and then succeeds", () => {
    /** @scenario "A transiently failing background step is retried after a backoff" */
    it("leaves it pending with its error, waits out the backoff, then runs it to done", async () => {
      const ledger = new MemoryBackgroundLedger();
      const clock = { now: 0 };
      let attempts = 0;
      const service = serviceOver({
        ledger,
        clock,
        run: async ({ checkpoint }) => {
          attempts += 1;
          await checkpoint.save({ report: { cursor: attempts } });
          if (attempts === 1) throw new Error("ClickHouse answered 503");
          return { cursor: attempts };
        },
      });

      expect(await sweepOnce(service)).toMatchObject({ retrying: [STEP], failed: [] });
      expect(ledger.row).toMatchObject({
        status: "pending",
        lastError: "ClickHouse answered 503",
        report: { cursor: 1 },
      });
      clock.now = 59_999;
      expect(await sweepOnce(service)).toMatchObject({ ran: [], retrying: [] });
      expect(attempts).toBe(1);
      clock.now = 60_000;
      expect(await sweepOnce(service)).toMatchObject({ ran: [STEP] });
      expect(ledger.row).toMatchObject({ status: "done", lastError: null });
    });
  });

  describe("given a step that always throws", () => {
    /** @scenario "A background step that fails every attempt stays failed and alerts" */
    it("records it failed after the last attempt and alerts naming the step and its module", async () => {
      const ledger = new MemoryBackgroundLedger();
      const clock = { now: 0 };
      const warnings: { message: string; fields: Record<string, unknown> }[] = [];
      const service = serviceOver({
        ledger,
        clock,
        log: (level, message, fields) => {
          if (level === "warn") warnings.push({ message, fields });
        },
        run: async () => {
          throw new Error("lock timeout");
        },
      });

      await sweepOnce(service);
      clock.now += 60_000;
      await sweepOnce(service);
      expect(ledger.row.status).toBe("pending");
      clock.now += 120_000;
      expect(await sweepOnce(service)).toMatchObject({ failed: [STEP], retrying: [] });

      expect(ledger.row).toMatchObject({ status: "failed", lastError: "lock timeout" });
      expect(warnings.at(-1)?.fields).toMatchObject({
        step: STEP,
        module: "identity",
        attempt: 3,
        attempts: 3,
        alert: true,
      });
    });
  });

  describe("given a step that returns once the worker is told to stop", () => {
    /** @scenario "A background step that returns after the worker is told to stop stays resumable" */
    it("is not recorded done and returns to pending with its saved checkpoint", async () => {
      const ledger = new MemoryBackgroundLedger();
      const stop = new AbortController();
      const service = serviceOver({
        ledger,
        run: async ({ checkpoint, signal }) => {
          await checkpoint.save({ report: { cursor: "project_7" } });
          stop.abort();
          return signal.aborted ? { stoppedAt: "project_7" } : { done: true };
        },
      });

      await sweepOnce(service, stop.signal);

      expect(ledger.row).toMatchObject({ status: "pending", report: { cursor: "project_7" } });
      expect(ledger.leaseOwner).toBeNull();
    });
  });

  describe("given a step that throws once the worker is told to stop", () => {
    /** @scenario "A background step that throws after the worker is told to stop stays resumable" */
    it("is not recorded failed and returns to pending with its saved checkpoint", async () => {
      const ledger = new MemoryBackgroundLedger();
      const stop = new AbortController();
      const service = serviceOver({
        ledger,
        run: async ({ checkpoint, signal }) => {
          await checkpoint.save({ report: { cursor: "project_7" } });
          stop.abort();
          signal.throwIfAborted();
          return {};
        },
      });

      expect(await sweepOnce(service, stop.signal)).toMatchObject({ failed: [], retrying: [] });

      expect(ledger.row).toMatchObject({
        status: "pending",
        lastError: null,
        report: { cursor: "project_7" },
      });
    });
  });

  describe("given one batch that outlasts the renewal interval without saving", () => {
    /** @scenario "The lease of a running background step is renewed on a timer" */
    it("renews the lease while the batch runs", async () => {
      const ledger = new MemoryBackgroundLedger();
      const service = serviceOver({
        ledger,
        run: async () => {
          await vi.advanceTimersByTimeAsync(3_500);
          return { batches: 1 };
        },
      });

      expect(await sweepOnce(service)).toMatchObject({ ran: [STEP] });

      expect(ledger.renewals).toBe(3);
    });
  });

  describe("given a running step whose lease another worker has taken", () => {
    /** @scenario "A failed lease renewal stops the holder and leaves the step resumable" */
    it("aborts the step, records neither done nor failed, and refuses a later checkpoint", async () => {
      const ledger = new MemoryBackgroundLedger();
      const saves: string[] = [];
      const service = serviceOver({
        ledger,
        run: async ({ checkpoint, signal }) => {
          await checkpoint.save({ report: { cursor: "project_1" } });
          ledger.refuseRenewals = true;
          await vi.advanceTimersByTimeAsync(1_000);
          expect(signal.aborted).toBe(true);
          await checkpoint
            .save({ report: { cursor: "project_2" } })
            .catch(() => saves.push("refused"));
          return { stoppedAt: "project_2" };
        },
      });

      expect(await sweepOnce(service)).toMatchObject({ ran: [], failed: [], retrying: [] });

      expect(saves).toEqual(["refused"]);
      expect(ledger.row).toMatchObject({ status: "running", report: { cursor: "project_1" } });
      expect(ledger.leaseOwner).toBe("worker-2");
    });
  });
});
