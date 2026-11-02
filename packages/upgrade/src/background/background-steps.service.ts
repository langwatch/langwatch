import type { ListedRun, ListedWork } from "@langwatch/eventing";
import { generate } from "@langwatch/ksuid";

import type { UpgradeStep } from "../ledger.ts";
import { redactSecrets } from "../runner/run-log.ts";
import type { MigrationStep } from "../step/migration-step.ts";
import { type LedgerTextRedactor, StepLogTail, ledgerText } from "../step/step-log.ts";

/** The ledger writes a background run needs; the two upgrade repositories answer them as built. */
export interface BackgroundStepsLedger {
  findSteps(): Promise<readonly Pick<UpgradeStep, "id" | "status" | "report">[]>;
  acquireLease(input: {
    name: string;
    owner: string;
    image: string;
    host: string;
    ttlMs: number;
  }): Promise<object | null>;
  renewLease(input: { name: string; owner: string; ttlMs: number }): Promise<object | null>;
  releaseLease(input: { name: string; owner: string }): Promise<boolean>;
  markRunning(input: { id: string; runId: string }): Promise<void>;
  setStatus(input: {
    ids: readonly string[];
    status: "done" | "failed" | "pending";
    runId: string;
    lastError?: string | null;
    report?: Record<string, unknown>;
    /** The attempt's last log lines, redacted; omitted keeps the stored tail. */
    logTail?: readonly string[];
  }): Promise<void>;
  saveReport(input: { id: string; report: Record<string, unknown> }): Promise<void>;
  /** Sets a running step pending with its checkpoint cleared, as a rollback reopens a done one. */
  reopen(input: { ids: readonly string[]; reason: string }): Promise<string[]>;
}

export type BackgroundStepsLog = (
  level: "info" | "warn",
  message: string,
  fields: Record<string, unknown>,
) => void;

/** What one pass did with each declared background step, by id. */
export type BackgroundSweep = Readonly<{
  paused: boolean;
  ran: readonly string[];
  failed: readonly string[];
  waiting: readonly string[];
  /** Failed with attempts left: pending again, run once its backoff has passed. */
  retrying: readonly string[];
}>;

/** A crashed worker's lease frees itself after this; a live run renews it on a timer. */
export const BACKGROUND_STEP_LEASE_TTL_MS = 120_000;

/** A quarter of the lease, as the runner lease (`runner-lease.ts`: 60 s, renewed every 15 s). */
export const BACKGROUND_STEP_RENEW_EVERY_MS = 30_000;

/** How often one worker retries a failing step, and how long it waits between attempts. */
export interface BackgroundStepRetry {
  attempts: number;
  firstBackoffMs: number;
  maxBackoffMs: number;
}

/** Plan 2026-10-08 F-3: bounded retries, then `failed` until the next `upgrade` resets it. */
export const BACKGROUND_STEP_RETRY: BackgroundStepRetry = {
  attempts: 5,
  firstBackoffMs: 60_000,
  maxBackoffMs: 15 * 60_000,
};

/** A swept run past this aborts, keeps its checkpoint and is pending again (ARCHITECTURE.md §7). */
export const BACKGROUND_STEP_DEADLINE_MS = 15 * 60_000;

/** How many background steps one worker runs side by side; each still holds its own lease. */
export const BACKGROUND_STEP_CONCURRENCY = 3;

/** How often the worker looks for a background step to run. */
export const BACKGROUND_SWEEP_EVERY_MS = 30_000;

/** Pending or left running by a dead worker: what a pass may pick up. */
const RUNNABLE = new Set<UpgradeStep["status"]>(["pending", "running"]);
const SETTLED = new Set<UpgradeStep["status"] | undefined>(["done", "not-needed"]);

const moduleOf = (id: string) => id.slice(0, id.indexOf(":"));
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface BackgroundStepsOptions {
  ledger: BackgroundStepsLedger;
  steps: readonly MigrationStep[];
  serving: () => boolean;
  oldWritersGoneFor: (input: { stepId: string }) => Promise<boolean>;
  identity: { owner: string; image: string; host: string };
  log: BackgroundStepsLog;
  leaseTtlMs?: number;
  renewEveryMs?: number;
  retry?: BackgroundStepRetry;
  deadlineMs?: number;
  /** A monotonic clock in milliseconds, for the retry backoff and the lease's last renewal. */
  now?: () => number;
  /** Where a step's queue work runs ahead of any backlog and is waited for (Alex, 2026-10-11). */
  queue?: BackgroundStepsQueue;
  /** How many steps run side by side; defaults to `BACKGROUND_STEP_CONCURRENCY`. */
  concurrency?: number;
  /** Masks what an error or log line may quote; defaults to the URL and `key=value` masks. */
  redact?: LedgerTextRedactor;
}

/** The job queue's listed runs: a run's jobs, and the jobs they cause, run ahead of any backlog. */
export interface BackgroundStepsQueue {
  runListedWork<Result>(input: ListedWork<Result>): Promise<Result>;
}

/** How long a step waits for its queue work unless it declares `queueWaitMs`. */
export const BACKGROUND_STEP_QUEUE_WAIT_MS = 5 * 60_000;

/**
 * A step's own jobs left waiting or running before its next checkpoint saves: the page it sent
 * must mostly run first, so a backfill never floods the queue ahead of live work (2026-10-12).
 */
export const BACKGROUND_STEP_MAX_OUTSTANDING_JOBS = 1_000;

type StepOutcome = "done" | "failed" | "retrying" | "held" | "waiting" | "skipped";

/**
 * Runs the background steps the worker's modules declare (ADR-173 §1), a few side by side under
 * their own leases while the process serves; an `after` step waits for its predecessors, and one
 * needing old writers gone waits for the serving roster. Spec: background-steps.feature.
 */
export class BackgroundStepsService {
  /** This worker's failed attempts per step, and when the next may start. */
  private readonly failures = new Map<string, { count: number; retryAt: number }>();

  private constructor(private readonly options: BackgroundStepsOptions) {}

  static create(options: BackgroundStepsOptions): BackgroundStepsService {
    return new BackgroundStepsService(options);
  }

  /**
   * One pass, steps started in declaration order a few at a time; never throws for a step's
   * failure. `after` reads the pass's snapshot, so a prerequisite done mid-pass frees its
   * dependants on the next pass, never beside it.
   */
  async sweep({ signal }: { signal: AbortSignal }): Promise<BackgroundSweep> {
    const sweep = { ran: [] as string[], failed: [] as string[], waiting: [] as string[] };
    const retrying: string[] = [];
    // A tenant step's pass runs in ops; its ledger row follows the pass (S6-WIRE, 2026-10-09).
    const declared = this.options.steps.filter(
      (step) => step.mode === "background" && step.kind !== "tenant",
    );
    if (declared.length === 0) return { paused: false, ...sweep, retrying };
    const rows = new Map((await this.options.ledger.findSteps()).map((row) => [row.id, row]));
    const outcomes = new Map<string, StepOutcome>();
    let paused = false;
    let thrown: { error: unknown } | undefined;
    await eachInLanes({
      items: declared,
      width: Math.max(1, this.options.concurrency ?? BACKGROUND_STEP_CONCURRENCY),
      stop: () => signal.aborted || paused || thrown !== undefined,
      each: async (step) => {
        if (!this.options.serving()) {
          paused = true;
          return;
        }
        try {
          outcomes.set(
            step.id,
            await this.sweepOne({ step, row: rows.get(step.id), rows, signal }),
          );
        } catch (error) {
          // A ledger read or lease call that throws ends the pass, as it did one step at a time.
          thrown ??= { error };
        }
      },
    });
    if (thrown) throw thrown.error;
    const by = { done: sweep.ran, failed: sweep.failed, waiting: sweep.waiting, retrying };
    for (const step of declared) {
      const outcome = outcomes.get(step.id);
      if (outcome && outcome !== "skipped" && outcome !== "held") by[outcome].push(step.id);
    }
    return { paused, ...sweep, retrying };
  }

  private now(): number {
    return (this.options.now ?? performance.now.bind(performance))();
  }

  private async sweepOne({
    step,
    row,
    rows,
    signal,
  }: {
    step: MigrationStep;
    row: Pick<UpgradeStep, "status" | "report"> | undefined;
    rows: ReadonlyMap<string, Pick<UpgradeStep, "status">>;
    signal: AbortSignal;
  }): Promise<StepOutcome> {
    if (!row || !RUNNABLE.has(row.status)) return "skipped";
    const unsettled = (step.after ?? []).filter((id) => !SETTLED.has(rows.get(id)?.status));
    if (unsettled.length > 0) return "waiting";
    const backoff = this.failures.get(step.id);
    if (backoff && this.now() < backoff.retryAt) return "skipped";
    const gone =
      !step.needsOldWritersGone || (await this.options.oldWritersGoneFor({ stepId: step.id }));
    if (!gone) return "waiting";
    const deadlineMs = this.options.deadlineMs ?? BACKGROUND_STEP_DEADLINE_MS;
    return this.runLeased({ step, signal, deadlineMs });
  }

  /**
   * Runs one step under its lease, renewed on a timer; a refused renewal aborts the run. A run
   * that ends aborted is never recorded done or failed: its checkpoint stays for the next attempt.
   * Past `deadlineMs` the run is no longer awaited, but its lease is renewed until it settles.
   */
  private async runLeased({
    step,
    signal,
    deadlineMs,
  }: {
    step: MigrationStep;
    signal: AbortSignal;
    deadlineMs?: number;
  }): Promise<StepOutcome> {
    const { ledger, identity, log } = this.options;
    const ttlMs = this.options.leaseTtlMs ?? BACKGROUND_STEP_LEASE_TTL_MS;
    const name = `background:${step.id}`;
    const lease = await ledger.acquireLease({ name, ttlMs, ...identity });
    if (!lease) return "held";
    const module = moduleOf(step.id);
    const runId = `background:${identity.owner}`;
    const held = this.holdLease({ name, ttlMs, signal, step: step.id, deadlineMs });
    const stepLog = StepLogTail.create({
      redact: this.redact,
      forward: (level, message, fields) =>
        log(level, message, { step: step.id, module, ...fields }),
    });
    let run: ReturnType<MigrationStep["run"]> | undefined;
    try {
      // Another worker may have finished it, or moved its checkpoint, since the sweep read it.
      const current = (await ledger.findSteps()).find((row) => row.id === step.id);
      if (!current || !RUNNABLE.has(current.status)) return "held";
      const resumeFrom = current.report ?? null;
      await ledger.markRunning({ id: step.id, runId });
      stepLog.info("background step started", { resumed: !!resumeFrom });
      run = this.runQueueWork({
        step,
        work: (list) =>
          step.run({
            checkpoint: {
              resumeFrom,
              save: async ({ report: saved }) => {
                await list?.waitForRoom({
                  maxOutstanding: BACKGROUND_STEP_MAX_OUTSTANDING_JOBS,
                  signal: held.signal,
                });
                if (held.lost())
                  throw new Error(`the lease of ${step.id} was lost; checkpoint refused`);
                if (held.expired())
                  throw new Error(`${step.id} passed its deadline; checkpoint refused`);
                await ledger.saveReport({ id: step.id, report: saved });
              },
            },
            dryRun: false,
            signal: held.signal,
            log: stepLog,
          }),
      });
      const report = await Promise.race([run, held.deadline]);
      if (held.signal.aborted) return await this.suspend({ step, runId, held, stepLog });
      if (await this.reopenedByRollback({ step })) return "waiting";
      stepLog.info("background step done");
      await ledger.setStatus({
        ids: [step.id],
        status: "done",
        runId,
        report,
        logTail: stepLog.tail(),
      });
      this.failures.delete(step.id);
      return "done";
    } catch (error) {
      if (held.signal.aborted) return await this.suspend({ step, runId, held, stepLog });
      return await this.recordFailure({ step, runId, error, stepLog });
    } finally {
      await this.releaseWhenSettled({ step: step.id, held, run });
    }
  }

  /**
   * A step's run on a queue list of its own: done only once every job it sent, and every job
   * those caused, has run. A failed or blocked job, or the wait running out, fails this run alone.
   */
  private runQueueWork<Result>({
    step,
    work,
  }: {
    step: MigrationStep;
    work: (list?: ListedRun) => Promise<Result>;
  }): Promise<Result> {
    const queue = this.options.queue;
    if (!queue) return work();
    return queue.runListedWork({
      name: `upgrade-step:${step.id}:${generate("steprun").toString()}`,
      timeoutMs: step.queueWaitMs ?? BACKGROUND_STEP_QUEUE_WAIT_MS,
      work,
    });
  }

  /** A run cut at its deadline may still write: no second copy starts until it settles. */
  private async releaseWhenSettled({
    step,
    held,
    run,
  }: {
    step: string;
    held: { expired: () => boolean; release: () => Promise<void> };
    run: Promise<unknown> | undefined;
  }): Promise<void> {
    if (!held.expired() || !run) return held.release();
    const release = () => held.release();
    void run.then(release, release).catch((error: unknown) => {
      this.options.log("warn", "background step lease not released", {
        step,
        error: messageOf(error),
      });
    });
  }

  /** A rollback while it ran (an older image serving again) reopens it, never recording it done. */
  private async reopenedByRollback({ step }: { step: MigrationStep }): Promise<boolean> {
    if (!step.needsOldWritersGone) return false;
    if (await this.options.oldWritersGoneFor({ stepId: step.id })) return false;
    const reason = `an older image started serving while ${step.id} ran; it runs again once old writers are gone`;
    await this.options.ledger.reopen({ ids: [step.id], reason });
    this.options.log("warn", "background step reopened: an older image serves again", {
      step: step.id,
      module: moduleOf(step.id),
    });
    return true;
  }

  /**
   * Renews the lease on a timer; the sweep, a lost lease or the deadline abort the run. A renewal
   * that never answers loses the lease once the time to live less one interval has passed.
   */
  private holdLease({
    name,
    ttlMs,
    signal,
    step,
    deadlineMs,
  }: {
    name: string;
    ttlMs: number;
    signal: AbortSignal;
    step: string;
    deadlineMs?: number;
  }) {
    const { ledger, identity, log } = this.options;
    const everyMs = this.options.renewEveryMs ?? BACKGROUND_STEP_RENEW_EVERY_MS;
    const controller = new AbortController();
    const onStop = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onStop, { once: true });
    let lost = false;
    const lose = (reason: string) => {
      if (lost) return;
      lost = true;
      log("warn", "background step lease lost; stopping the step", { step, reason });
      controller.abort(new Error(reason));
    };
    let renewedAt = this.now();
    let renewing = false;
    const renew = async () => {
      if (this.now() - renewedAt >= ttlMs - everyMs)
        return lose("the lease was not renewed in time");
      if (renewing) return;
      renewing = true;
      const sentAt = this.now();
      try {
        const renewed = await ledger.renewLease({ name, owner: identity.owner, ttlMs });
        if (renewed) renewedAt = Math.max(renewedAt, sentAt);
        else lose("another worker holds the lease");
      } catch (error) {
        lose(`the lease could not be renewed: ${messageOf(error)}`);
      } finally {
        renewing = false;
      }
    };
    const timer = setInterval(() => void renew(), everyMs);
    timer.unref?.();
    let expired = false;
    let expire: (reason: Error) => void = () => undefined;
    const deadline = new Promise<never>((_, reject) => (expire = reject));
    deadline.catch(() => undefined);
    const deadlineTimer =
      deadlineMs === undefined
        ? undefined
        : setTimeout(() => {
            expired = true;
            const reason = new Error(
              `the run passed its ${Math.round(deadlineMs / 60_000)}-minute deadline; it resumes from its checkpoint`,
            );
            log("warn", "background step passed its deadline; stopping the step", {
              step,
              deadlineMs,
            });
            controller.abort(reason);
            expire(reason);
          }, deadlineMs);
    deadlineTimer?.unref?.();
    let released: Promise<void> | undefined;
    return {
      signal: controller.signal,
      deadline,
      lost: () => lost,
      expired: () => expired,
      /** Stops renewing and releases the lease, once; a lost lease is another holder's. */
      release: () =>
        (released ??= (async () => {
          clearInterval(timer);
          clearTimeout(deadlineTimer);
          signal.removeEventListener("abort", onStop);
          if (!lost) await ledger.releaseLease({ name, owner: identity.owner });
        })()),
    };
  }

  /** A stopped run returns its step to pending, naming an expiry; a lost lease leaves the row. */
  private async suspend({
    step,
    runId,
    held,
    stepLog,
  }: {
    step: MigrationStep;
    runId: string;
    held: { signal: AbortSignal; lost: () => boolean; expired: () => boolean };
    stepLog: StepLogTail;
  }): Promise<"held"> {
    const lost = held.lost();
    const lastError = held.expired() ? this.errorText(held.signal.reason) : null;
    stepLog.info("background step stopped; it resumes from its checkpoint", {
      leaseLost: lost,
      expired: held.expired(),
    });
    if (!lost) {
      await this.options.ledger.setStatus({
        ids: [step.id],
        status: "pending",
        runId,
        lastError,
        logTail: stepLog.tail(),
      });
    }
    return "held";
  }

  /** Pending again after a backoff while attempts remain; then failed, with an alert. */
  private async recordFailure({
    step,
    runId,
    error,
    stepLog,
  }: {
    step: MigrationStep;
    runId: string;
    error: unknown;
    stepLog: StepLogTail;
  }): Promise<"failed" | "retrying"> {
    const { ledger } = this.options;
    const retry = this.options.retry ?? BACKGROUND_STEP_RETRY;
    const lastError = this.errorText(error);
    const attempt = (this.failures.get(step.id)?.count ?? 0) + 1;
    const fields = { error: lastError, attempt };
    if (attempt < retry.attempts) {
      const retryInMs = Math.min(retry.firstBackoffMs * 2 ** (attempt - 1), retry.maxBackoffMs);
      this.failures.set(step.id, { count: attempt, retryAt: this.now() + retryInMs });
      stepLog.warn("background step failed; retrying after a backoff", { ...fields, retryInMs });
      await ledger.setStatus({
        ids: [step.id],
        status: "pending",
        runId,
        lastError,
        logTail: stepLog.tail(),
      });
      return "retrying";
    }
    this.failures.delete(step.id);
    stepLog.warn("background step failed", {
      ...fields,
      attempts: retry.attempts,
      alert: true,
      next: "fix the cause; the next `pnpm task upgrade` run sets it pending again",
    });
    await ledger.setStatus({
      ids: [step.id],
      status: "failed",
      runId,
      lastError,
      logTail: stepLog.tail(),
    });
    return "failed";
  }

  private get redact(): LedgerTextRedactor {
    return this.options.redact ?? redactSecrets;
  }

  /** The error as the ledger stores it: redacted and cut to its cap. */
  private errorText(error: unknown): string {
    return ledgerText({ text: messageOf(error), redact: this.redact });
  }
}

/** Runs `each` over the items in order, at most `width` at once, taking none once `stop` says. */
async function eachInLanes<Item>({
  items,
  width,
  stop,
  each,
}: {
  items: readonly Item[];
  width: number;
  stop: () => boolean;
  each: (item: Item) => Promise<void>;
}): Promise<void> {
  const pending = [...items];
  const lane = async (): Promise<void> => {
    while (pending.length > 0 && !stop()) {
      const item = pending.shift();
      if (item !== undefined) await each(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
}

/** The worker's loop over one service: a pass now, then one every `everyMs`, stopped by `stop`. */
export function startBackgroundSteps({
  service,
  everyMs = BACKGROUND_SWEEP_EVERY_MS,
  log,
}: {
  service: Pick<BackgroundStepsService, "sweep">;
  everyMs?: number;
  log: BackgroundStepsLog;
}): { stop: () => Promise<void> } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pass: Promise<void> = Promise.resolve();
  const schedule = () => {
    if (controller.signal.aborted) return;
    timer = setTimeout(() => (pass = once()), everyMs);
    timer.unref?.();
  };
  const once = async () => {
    try {
      await service.sweep({ signal: controller.signal });
    } catch (error) {
      log("warn", "background steps pass failed", { error: messageOf(error) });
    }
    schedule();
  };
  pass = once();
  return {
    stop: async () => {
      controller.abort();
      clearTimeout(timer);
      await pass;
    },
  };
}
