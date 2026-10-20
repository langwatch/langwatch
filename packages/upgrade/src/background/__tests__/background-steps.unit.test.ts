import type { ListedWork } from "@langwatch/eventing";
/**
 * A paused worker runs nothing; a stopped or failing step stays resumable; the lease renews on a
 * timer. Spec: specs/upgrade/background-steps.feature.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpgradeStep } from "../../ledger.ts";
import {
  defineMigrationStep,
  type MigrationStep,
  type MigrationStepRun,
} from "../../step/migration-step.ts";
import {
  LEDGER_TEXT_MAX_CHARS,
  type LedgerTextRedactor,
  ledgerRedactor,
} from "../../step/step-log.ts";
import {
  type BackgroundStepsLedger,
  type BackgroundStepsLog,
  type BackgroundStepsQueue,
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
        reopen: refuse,
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

  describe("given a background step of kind tenant", () => {
    it("never runs it: ops' pass walks its tenants", async () => {
      const tenant: MigrationStep = {
        id: "prompt:seed-default-tags",
        kind: "tenant",
        mode: "background",
        description: "Seeds the default prompt tags into every organization.",
        run: refuse,
      };
      const ledger: BackgroundStepsLedger = {
        findSteps: async () => [{ id: tenant.id, status: "pending", report: null }],
        acquireLease: refuse,
        renewLease: refuse,
        releaseLease: refuse,
        markRunning: refuse,
        reopen: refuse,
        setStatus: refuse,
        saveReport: refuse,
      };
      const service = BackgroundStepsService.create({
        ledger,
        steps: [tenant],
        serving: () => true,
        oldWritersGoneFor: async () => true,
        identity: { owner: "worker-1", image: "3.21.0", host: "host" },
        log: () => undefined,
      });

      const sweep = await service.sweep({ signal: new AbortController().signal });

      expect(sweep).toEqual({ paused: false, ran: [], failed: [], waiting: [], retrying: [] });
    });
  });

  describe("given a step that runs after a step not yet done", () => {
    /** @scenario "A worker holds a background step until every step it runs after is done" */
    it("waits on it and runs nothing until the named step is done", async () => {
      const copy = defineMigrationStep({
        id: "evaluation:copy-inputs",
        kind: "data",
        mode: "background",
        description: "Copies evaluation inputs.",
        run: refuse,
      });
      const ledger: BackgroundStepsLedger = {
        findSteps: async () => [
          { id: "evaluation:copy-inputs", status: "running", report: null },
          { id: "evaluation:purge-inputs", status: "pending", report: null },
        ],
        acquireLease: async () => null,
        renewLease: refuse,
        releaseLease: refuse,
        markRunning: refuse,
        reopen: refuse,
        setStatus: refuse,
        saveReport: refuse,
      };
      const service = BackgroundStepsService.create({
        ledger,
        steps: [
          defineMigrationStep({
            id: "evaluation:purge-inputs",
            kind: "data",
            mode: "background",
            description: "Purges copied evaluation inputs.",
            after: [copy],
            run: refuse,
          }),
        ],
        serving: () => true,
        oldWritersGoneFor: async () => true,
        identity: { owner: "worker-1", image: "3.21.0", host: "host" },
        log: () => undefined,
      });

      const sweep = await service.sweep({ signal: new AbortController().signal });

      expect(sweep.waiting).toEqual(["evaluation:purge-inputs"]);
      expect(sweep.ran).toEqual([]);
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
        reopen: refuse,
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
type Row = Pick<UpgradeStep, "id" | "status" | "report" | "lastError"> & {
  logTail?: readonly string[];
};

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
  setStatus: BackgroundStepsLedger["setStatus"] = async ({
    status,
    lastError,
    report,
    logTail,
  }) => {
    this.row = {
      ...this.row,
      status,
      lastError: lastError ?? null,
      report: report ?? this.row.report,
      logTail: logTail ?? this.row.logTail,
    };
  };
  saveReport = async ({ report }: { report: Record<string, unknown> }) => {
    this.row = { ...this.row, report };
  };
  reopen = async ({ ids, reason }: { ids: readonly string[]; reason: string }) => {
    if (this.row.status !== "running") return [];
    this.row = { ...this.row, status: "pending", report: null, lastError: reason };
    return [...ids];
  };
}

function serviceOver({
  ledger,
  run,
  log = () => undefined,
  clock = { now: 0 },
  queue,
  queueWaitMs,
  redact,
}: {
  ledger: MemoryBackgroundLedger;
  run: MigrationStepRun;
  log?: BackgroundStepsLog;
  clock?: { now: number };
  queue?: BackgroundStepsQueue;
  queueWaitMs?: number;
  redact?: LedgerTextRedactor;
}) {
  return BackgroundStepsService.create({
    ledger,
    steps: [
      defineMigrationStep({
        id: STEP,
        kind: "data",
        mode: "background",
        description: "Reopens accounts that never proved their address.",
        ...(queueWaitMs === undefined ? {} : { queueWaitMs }),
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
    ...(queue === undefined ? {} : { queue }),
    ...(redact === undefined ? {} : { redact }),
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

describe("BackgroundStepsService deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a step whose run neither finishes nor fails, before a pending step", () => {
    /** @scenario "A background step that never returns does not starve the steps after it" */
    it("cuts the stuck run at its deadline, keeps its checkpoint pending and runs the next step", async () => {
      const rows = new Map<string, Row>(
        ["trace:stuck", "trace:later"].map((id) => [
          id,
          { id, status: "pending", report: null, lastError: null },
        ]),
      );
      const update = (id: string, changes: Partial<Row>) => {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, ...changes });
      };
      const ledger: BackgroundStepsLedger = {
        findSteps: async () => [...rows.values()],
        acquireLease: async () => ({}),
        renewLease: async () => ({}),
        releaseLease: async () => true,
        markRunning: async ({ id }) => update(id, { status: "running" }),
        setStatus: async ({ ids, status, lastError, report }) => {
          for (const id of ids)
            update(id, { status, lastError: lastError ?? null, ...(report ? { report } : {}) });
        },
        saveReport: async ({ id, report }) => update(id, { report }),
        reopen: async () => [],
      };
      let lateSave: Promise<string> | undefined;
      const stuck = defineMigrationStep({
        id: "trace:stuck",
        kind: "data",
        mode: "background",
        description: "Waits on a mutation that never ends, ignoring its signal.",
        run: async ({ checkpoint }) => {
          await checkpoint.save({ report: { cursor: "part_4" } });
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          lateSave = checkpoint.save({ report: { cursor: "part_5" } }).then(
            () => "saved",
            (error: unknown) => String(error),
          );
          return new Promise<never>(() => undefined);
        },
      });
      const later = defineMigrationStep({
        id: "trace:later",
        kind: "data",
        mode: "background",
        description: "Runs after the stuck step.",
        run: async () => ({ done: true }),
      });
      const warnings: string[] = [];
      const service = BackgroundStepsService.create({
        ledger,
        steps: [stuck, later],
        serving: () => true,
        oldWritersGoneFor: async () => true,
        identity: { owner: "worker-1", image: "3.21.0", host: "host" },
        log: (level, message) => void (level === "warn" && warnings.push(message)),
        deadlineMs: 5_000,
      });

      const pass = service.sweep({ signal: new AbortController().signal });
      await vi.advanceTimersByTimeAsync(5_000);
      const sweep = await pass;
      await vi.advanceTimersByTimeAsync(5_000);

      expect(sweep).toMatchObject({ ran: ["trace:later"], failed: [], retrying: [] });
      expect(rows.get("trace:stuck")).toMatchObject({
        status: "pending",
        report: { cursor: "part_4" },
        lastError: expect.stringContaining("deadline"),
      });
      expect(rows.get("trace:later")?.status).toBe("done");
      await expect(lateSave).resolves.toMatch(/passed its deadline; checkpoint refused/);
      expect(rows.get("trace:stuck")?.report).toEqual({ cursor: "part_4" });
      expect(warnings).toContain("background step passed its deadline; stopping the step");
    });
  });

  describe("given a step that ends inside its deadline", () => {
    it("records it done and leaves no deadline behind", async () => {
      const ledger = new MemoryBackgroundLedger();
      const service = serviceOver({ ledger, run: async () => ({ done: true }) });

      expect(await sweepOnce(service)).toMatchObject({ ran: [STEP] });
      expect(vi.getTimerCount()).toBe(0);
      expect(ledger.row).toMatchObject({ status: "done", lastError: null });
    });
  });
});

describe("BackgroundStepsService.sweep() with old writers", () => {
  describe("given a step that needs old writers gone, live on the first sweep and gone on the next", () => {
    /** @scenario "A step is stamped started only once old writers are gone" */
    it("marks it running only on the sweep that finds them gone", async () => {
      const id = "data-retention:keep-control-plane-events-forever";
      const marked: number[] = [];
      let sweepNo = 0;
      const service = BackgroundStepsService.create({
        ledger: {
          findSteps: async () => [{ id, status: "pending", report: null }],
          acquireLease: async () => ({}),
          renewLease: async () => ({}),
          releaseLease: async () => true,
          markRunning: async () => {
            marked.push(sweepNo);
          },
          setStatus: async () => undefined,
          saveReport: async () => undefined,
          reopen: async () => [],
        },
        steps: [
          defineMigrationStep({
            id,
            kind: "data",
            mode: "background",
            description: "Keeps control-plane events forever.",
            needsOldWritersGone: true,
            run: async () => ({}),
          }),
        ],
        serving: () => true,
        oldWritersGoneFor: async () => sweepNo > 1,
        identity: { owner: "worker-1", image: "3.21.0", host: "host" },
        log: () => undefined,
      });
      const signal = new AbortController().signal;

      sweepNo = 1;
      expect((await service.sweep({ signal })).waiting).toEqual([id]);
      sweepNo = 2;
      expect((await service.sweep({ signal })).ran).toEqual([id]);
      expect(marked).toEqual([2]);
    });
  });
});

describe("BackgroundStepsService one copy at a time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const serviceFor = ({
    ledger,
    run,
    gone = async () => true,
    clock,
    deadlineMs,
    log = () => undefined,
  }: {
    ledger: MemoryBackgroundLedger;
    run: MigrationStepRun;
    gone?: () => Promise<boolean>;
    clock?: { now: number };
    deadlineMs?: number;
    log?: BackgroundStepsLog;
  }) =>
    BackgroundStepsService.create({
      ledger,
      steps: [
        defineMigrationStep({
          id: STEP,
          kind: "data",
          mode: "background",
          description: "Reopens accounts that never proved their address.",
          needsOldWritersGone: true,
          run,
        }),
      ],
      serving: () => true,
      oldWritersGoneFor: gone,
      identity: { owner: "worker-1", image: "3.21.0", host: "host" },
      log,
      renewEveryMs: 1_000,
      leaseTtlMs: 3_000,
      ...(deadlineMs === undefined ? {} : { deadlineMs }),
      ...(clock ? { now: () => clock.now } : {}),
    });

  describe("given a step whose run ignores its signal past its deadline", () => {
    /** @scenario "A step cut at its deadline keeps its lease until its run settles" */
    it("sets it pending and moves on, renewing its lease until the cut run settles", async () => {
      const ledger = new MemoryBackgroundLedger();
      let finish: (report: Record<string, unknown>) => void = () => undefined;
      const service = serviceFor({
        ledger,
        deadlineMs: 5_000,
        run: () => new Promise((resolve) => (finish = resolve)),
      });

      const pass = sweepOnce(service);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pass).toMatchObject({ ran: [], failed: [] });
      expect(ledger.row).toMatchObject({
        status: "pending",
        lastError: expect.stringContaining("deadline"),
      });

      const renewalsAtCut = ledger.renewals;
      await vi.advanceTimersByTimeAsync(3_000);
      expect(ledger.renewals).toBeGreaterThan(renewalsAtCut);
      expect(ledger.leaseOwner).toBe("worker-1");
      expect(await sweepOnce(service)).toMatchObject({ ran: [] });

      finish({ late: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(ledger.leaseOwner).toBeNull();
      expect(ledger.row.status).toBe("pending");
    });
  });

  describe("given a checkpoint that moved after the sweep read it", () => {
    /** @scenario "A step resumes from the checkpoint read after taking its lease" */
    it("resumes from the checkpoint read after taking the lease", async () => {
      const ledger = new MemoryBackgroundLedger();
      ledger.row = { ...ledger.row, report: { cursor: "project_1" } };
      const acquire = ledger.acquireLease;
      ledger.acquireLease = async (input) => {
        ledger.row = { ...ledger.row, report: { cursor: "project_7" } };
        return acquire(input);
      };
      let resumedFrom: unknown = null;
      const service = serviceFor({
        ledger,
        run: async ({ checkpoint }) => {
          resumedFrom = checkpoint.resumeFrom;
          return { done: true };
        },
      });

      expect(await sweepOnce(service)).toMatchObject({ ran: [STEP] });
      expect(resumedFrom).toEqual({ cursor: "project_7" });
    });
  });

  describe("given a running step whose lease renewal never answers", () => {
    /** @scenario "A background step whose renewal never answers is stopped" */
    it("aborts it once the time to live less one interval passes, and records it neither done nor failed", async () => {
      const ledger = new MemoryBackgroundLedger();
      ledger.renewLease = () => new Promise(() => undefined);
      const clock = { now: 0 };
      const warnings: string[] = [];
      const service = serviceFor({
        ledger,
        clock,
        log: (level, _message, fields) =>
          void (level === "warn" && warnings.push(String(fields.reason))),
        run: async ({ signal }) => {
          for (let tick = 0; tick < 10 && !signal.aborted; tick++) {
            clock.now += 1_000;
            await vi.advanceTimersByTimeAsync(1_000);
          }
          expect(signal.aborted).toBe(true);
          expect(clock.now).toBe(2_000);
          return { stopped: true };
        },
      });

      expect(await sweepOnce(service)).toMatchObject({ ran: [], failed: [], retrying: [] });
      expect(ledger.row.status).toBe("running");
      expect(warnings).toContain("the lease was not renewed in time");
    });
  });

  describe("given an older image that starts serving while the step runs", () => {
    /** @scenario "A step that needs old writers gone is reopened when an old writer starts during its run" */
    it("reopens it with its checkpoint cleared instead of recording it done", async () => {
      const ledger = new MemoryBackgroundLedger();
      let gone = true;
      const service = serviceFor({
        ledger,
        gone: async () => gone,
        run: async ({ checkpoint }) => {
          await checkpoint.save({ report: { cursor: "project_3" } });
          gone = false;
          return { done: true };
        },
      });

      expect(await sweepOnce(service)).toMatchObject({ ran: [], waiting: [STEP] });
      expect(ledger.row).toMatchObject({
        status: "pending",
        report: null,
        lastError: expect.stringContaining("older image"),
      });
      expect(ledger.leaseOwner).toBeNull();
    });
  });
});

/** The job queue's listed runs: records each run, and answers with the work or a refusal. */
class ListedRunsDouble implements BackgroundStepsQueue {
  readonly runs: { name: string; timeoutMs: number }[] = [];
  refusal: Error | undefined;

  async runListedWork<Result>({
    name,
    timeoutMs,
    work,
  }: {
    name: string;
    timeoutMs: number;
    work: () => Promise<Result>;
  }): Promise<Result> {
    this.runs.push({ name, timeoutMs });
    const result = await work();
    if (this.refusal) throw this.refusal;
    return result;
  }
}

describe("BackgroundStepsService queue work", () => {
  describe("given a step whose queue work all runs", () => {
    /** @scenario "A background step is done only once the queue work it sent has run" */
    it("runs the step on a list of its own, waiting 5 minutes by default, and records it done", async () => {
      const ledger = new MemoryBackgroundLedger();
      const queue = new ListedRunsDouble();
      const service = serviceOver({ ledger, queue, run: async () => ({ sent: 2 }) });

      expect(await sweepOnce(service)).toMatchObject({ ran: [STEP] });

      expect(queue.runs).toEqual([
        { name: expect.stringMatching(`^upgrade-step:${STEP}:`), timeoutMs: 5 * 60_000 },
      ]);
      expect(ledger.row).toMatchObject({ status: "done", report: { sent: 2 } });
    });
  });

  describe("given two runs of a step that declares a longer wait", () => {
    it("waits as long as it declares, on a new list each run", async () => {
      const ledger = new MemoryBackgroundLedger();
      const queue = new ListedRunsDouble();
      queue.refusal = new Error("Queue work had not all run within 300000 ms");
      const clock = { now: 0 };
      const service = serviceOver({
        ledger,
        queue,
        clock,
        queueWaitMs: 300_000,
        run: async () => ({ sent: 1 }),
      });

      await sweepOnce(service);
      queue.refusal = undefined;
      clock.now = 600_000;
      await sweepOnce(service);

      expect(queue.runs.map((run) => run.timeoutMs)).toEqual([300_000, 300_000]);
      expect(new Set(queue.runs.map((run) => run.name)).size).toBe(2);
    });
  });

  describe("given a step whose queue work failed or did not run in time", () => {
    /** @scenario "A step whose queue work stops draining fails that attempt and stays resumable" */
    it("is not recorded done: pending again with the refusal and its checkpoint kept", async () => {
      const ledger = new MemoryBackgroundLedger();
      const queue = new ListedRunsDouble();
      queue.refusal = new Error(
        "Queue work of upgrade-step had not all run within 60000 ms (still waiting: t/command/a)",
      );
      const service = serviceOver({
        ledger,
        queue,
        run: async ({ checkpoint }) => {
          await checkpoint.save({ report: { sent: 1 } });
          return { sent: 1 };
        },
      });

      expect(await sweepOnce(service)).toMatchObject({ ran: [], retrying: [STEP] });

      expect(ledger.row).toMatchObject({
        status: "pending",
        report: { sent: 1 },
        lastError: expect.stringContaining("still waiting: t/command/a"),
      });
    });
  });
});

/** A queue whose worker runs a step's jobs as the step waits for room, counting the outstanding. */
class PacedRunsDouble implements BackgroundStepsQueue {
  outstanding = 0;
  peak = 0;
  ran = 0;
  readonly rooms: number[] = [];

  send(): void {
    this.outstanding += 1;
    this.peak = Math.max(this.peak, this.outstanding);
  }

  private runDownTo(bound: number): void {
    const running = Math.max(0, this.outstanding - bound);
    this.outstanding -= running;
    this.ran += running;
  }

  async runListedWork<Result>({ work }: ListedWork<Result>): Promise<Result> {
    const result = await work({
      waitForRoom: async ({ maxOutstanding }) => {
        this.rooms.push(maxOutstanding);
        this.runDownTo(maxOutstanding);
      },
    });
    this.runDownTo(0);
    return result;
  }
}

describe("BackgroundStepsService pacing", () => {
  describe("given a step over 10,000 rows that sends a job per row, 500 rows a page", () => {
    /** @scenario "A step over many rows keeps at most a page and a small bound of its own jobs outstanding" */
    it("saves each page only once at most 1,000 of its jobs are outstanding, and finishes every row", async () => {
      const ledger = new MemoryBackgroundLedger();
      const queue = new PacedRunsDouble();
      const rows = 10_000;
      const page = 500;
      const service = serviceOver({
        ledger,
        queue,
        run: async ({ checkpoint }) => {
          let sent = 0;
          while (sent < rows) {
            for (let row = 0; row < page; row++) queue.send();
            sent += page;
            await checkpoint.save({ report: { sent } });
          }
          return { sent };
        },
      });

      expect(await sweepOnce(service)).toMatchObject({ ran: [STEP] });

      expect(queue.rooms).toEqual(Array.from({ length: rows / page }, () => 1_000));
      expect(queue.peak).toBeLessThanOrEqual(1_000 + page);
      expect(queue.ran).toBe(rows);
      expect(ledger.row).toMatchObject({ status: "done", report: { sent: rows } });
    });
  });
});

describe("BackgroundStepsService side by side", () => {
  describe("given five independent pending steps and one that runs after another", () => {
    /** @scenario "Independent background steps run side by side, a few at a time" */
    it("runs three at once under their own leases, and the dependent step waits", async () => {
      const ids = ["a:one", "a:two", "a:three", "a:four", "a:five"];
      let running = 0;
      let widest = 0;
      const leases: string[] = [];
      const step = (id: string, after?: Parameters<typeof defineMigrationStep>[0]["after"]) =>
        defineMigrationStep({
          id,
          kind: "data",
          mode: "background",
          description: `Runs ${id}.`,
          ...(after ? { after } : {}),
          run: async () => {
            running += 1;
            widest = Math.max(widest, running);
            await new Promise((resolve) => setTimeout(resolve, 10));
            running -= 1;
            return { id };
          },
        });
      const ledger: BackgroundStepsLedger = {
        findSteps: async () =>
          [...ids, "a:six"].map((id) => ({ id, status: "pending" as const, report: null })),
        acquireLease: async ({ name }) => {
          leases.push(name);
          return {};
        },
        renewLease: async () => ({}),
        releaseLease: async () => true,
        markRunning: async () => undefined,
        reopen: async () => [],
        setStatus: async () => undefined,
        saveReport: async () => undefined,
      };
      const independent = ids.map((id) => step(id));
      const service = BackgroundStepsService.create({
        ledger,
        steps: [...independent, step("a:six", [independent[0]!])],
        serving: () => true,
        oldWritersGoneFor: async () => true,
        identity: { owner: "worker-1", image: "3.21.0", host: "host" },
        log: () => undefined,
      });

      const sweep = await service.sweep({ signal: new AbortController().signal });

      expect(widest).toBe(3);
      expect(sweep.ran).toEqual(ids);
      expect(sweep.waiting).toEqual(["a:six"]);
      expect(leases.toSorted()).toEqual(ids.map((id) => `background:${id}`).toSorted());
    });
  });
});

describe("BackgroundStepsService diagnostics", () => {
  const failing = (message: string) => async () => {
    throw new Error(message);
  };

  describe("given a step whose error names a database URL with its password", () => {
    /** @scenario "A step's error is redacted before the ledger stores it" */
    it("stores the error with the password masked and the user and host kept", async () => {
      const ledger = new MemoryBackgroundLedger();
      const service = serviceOver({
        ledger,
        run: failing("connect to postgres://langwatch:hunter2secret@db.internal:5432/app failed"),
      });

      await sweepOnce(service);

      expect(ledger.row.lastError).toContain("postgres://langwatch:***@db.internal:5432/app");
      expect(ledger.row.lastError).not.toContain("hunter2secret");
    });
  });

  describe("given a worker that holds a ClickHouse URL as a secret", () => {
    /** @scenario "A step's error naming a secret the process holds is redacted before it is stored" */
    it("stores the error without the URL, even where no pattern would match it", async () => {
      const ledger = new MemoryBackgroundLedger();
      const secret = "clickhouse-host.internal:8123/?user=default&k=9f8e7d6c5b4a";
      const service = serviceOver({
        ledger,
        redact: ledgerRedactor({ secretValues: [secret] }),
        run: failing(`ClickHouse refused ${secret} after 3 tries`),
      });

      await sweepOnce(service);

      expect(ledger.row.lastError).toBe("ClickHouse refused *** after 3 tries");
    });
  });

  describe("given a step that fails with a 20 KB error", () => {
    /** @scenario "A very long step error is cut before it is stored" */
    it("stores at most 4 KB and marks the cut", async () => {
      const ledger = new MemoryBackgroundLedger();
      const service = serviceOver({ ledger, run: failing("x".repeat(20_000)) });

      await sweepOnce(service);

      expect(ledger.row.lastError?.length).toBeLessThanOrEqual(LEDGER_TEXT_MAX_CHARS);
      expect(ledger.row.lastError?.endsWith("[cut]")).toBe(true);
    });
  });

  describe("given a step that logs two lines and then fails", () => {
    /** @scenario "A background step's log lines are kept with its attempt" */
    it("keeps the start line, both lines and the failure line, redacted, and forwards them", async () => {
      const ledger = new MemoryBackgroundLedger();
      const forwarded: string[] = [];
      const service = serviceOver({
        ledger,
        log: (_level, message, fields) => void forwarded.push(`${message} ${String(fields.step)}`),
        run: async ({ log }) => {
          log.info("read page", { afterId: "project_1" });
          log.warn("skipped an agent", { token: "x", note: "password=opensesame" });
          throw new Error("boom");
        },
      });

      await sweepOnce(service);

      const tail = ledger.row.logTail ?? [];
      expect(tail.map((line) => line.split(" ").slice(1, 3).join(" "))).toEqual([
        "info background",
        "info read",
        "warn skipped",
        "warn background",
      ]);
      expect(tail.join("\n")).not.toContain("opensesame");
      expect(forwarded).toContain(`read page ${STEP}`);
    });
  });
});
