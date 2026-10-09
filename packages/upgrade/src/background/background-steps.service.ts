import type { UpgradeStep } from "../ledger.ts";
import type { MigrationStep, MigrationStepReport } from "../step/migration-step.ts";

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
  }): Promise<void>;
  saveReport(input: { id: string; report: Record<string, unknown> }): Promise<void>;
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
  /** A monotonic clock in milliseconds, for the retry backoff. */
  now?: () => number;
}

type StepOutcome = "done" | "failed" | "retrying" | "held" | "waiting" | "skipped";

/**
 * Runs the background steps the worker's modules declare (ADR-173 §1, round 14: the framework
 * runs). One step at a time under its own lease, only while the process serves, and a step that
 * needs old writers gone only once the serving roster says so. Spec: background-steps.feature.
 */
export class BackgroundStepsService {
  /** This worker's failed attempts per step, and when the next may start. */
  private readonly failures = new Map<string, { count: number; retryAt: number }>();

  private constructor(private readonly options: BackgroundStepsOptions) {}

  static create(options: BackgroundStepsOptions): BackgroundStepsService {
    return new BackgroundStepsService(options);
  }

  /** One pass over the declared steps in declaration order; never throws for a step's failure. */
  async sweep({ signal }: { signal: AbortSignal }): Promise<BackgroundSweep> {
    const sweep = { ran: [] as string[], failed: [] as string[], waiting: [] as string[] };
    const retrying: string[] = [];
    const declared = this.options.steps.filter((step) => step.mode === "background");
    if (declared.length === 0) return { paused: false, ...sweep, retrying };
    const rows = new Map((await this.options.ledger.findSteps()).map((row) => [row.id, row]));
    const by = { done: sweep.ran, failed: sweep.failed, waiting: sweep.waiting, retrying };
    for (const step of declared) {
      if (signal.aborted) break;
      if (!this.options.serving()) return { paused: true, ...sweep, retrying };
      const outcome = await this.sweepOne({ step, row: rows.get(step.id), rows, signal });
      if (outcome !== "skipped" && outcome !== "held") by[outcome].push(step.id);
    }
    return { paused: false, ...sweep, retrying };
  }

  /**
   * Runs one step now, as `upgrade` does before a contract step (Alex, 2026-10-09): forced, so
   * neither serving nor the serving roster is asked. A step not pending or running is skipped.
   */
  async runNow({ id, signal }: { id: string; signal: AbortSignal }): Promise<StepOutcome> {
    const step = this.options.steps.find((each) => each.id === id);
    const row = (await this.options.ledger.findSteps()).find((each) => each.id === id);
    if (!step || !row || !RUNNABLE.has(row.status)) return "skipped";
    return this.runLeased({ step, resumeFrom: row.report ?? null, signal });
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
    return this.runLeased({ step, resumeFrom: row.report ?? null, signal });
  }

  /**
   * Runs one step under its lease, renewed on a timer; a refused renewal aborts the run. A run
   * that ends aborted is never recorded done or failed: its checkpoint stays for the next attempt.
   */
  private async runLeased({
    step,
    resumeFrom,
    signal,
  }: {
    step: MigrationStep;
    resumeFrom: MigrationStepReport | null;
    signal: AbortSignal;
  }): Promise<StepOutcome> {
    const { ledger, identity, log } = this.options;
    const ttlMs = this.options.leaseTtlMs ?? BACKGROUND_STEP_LEASE_TTL_MS;
    const name = `background:${step.id}`;
    const lease = await ledger.acquireLease({ name, ttlMs, ...identity });
    if (!lease) return "held";
    const module = moduleOf(step.id);
    const runId = `background:${identity.owner}`;
    const held = this.holdLease({ name, ttlMs, signal, step: step.id });
    try {
      // Another worker may have finished it between the read and the lease.
      const current = (await ledger.findSteps()).find((row) => row.id === step.id);
      if (!current || !RUNNABLE.has(current.status)) return "held";
      await ledger.markRunning({ id: step.id, runId });
      log("info", "background step started", { step: step.id, module, resumed: !!resumeFrom });
      const report = await step.run({
        checkpoint: {
          resumeFrom,
          save: async ({ report: saved }) => {
            if (held.lost())
              throw new Error(`the lease of ${step.id} was lost; checkpoint refused`);
            await ledger.saveReport({ id: step.id, report: saved });
          },
        },
        dryRun: false,
        signal: held.signal,
      });
      if (held.signal.aborted) return await this.suspend({ step, runId, lost: held.lost() });
      await ledger.setStatus({ ids: [step.id], status: "done", runId, report });
      this.failures.delete(step.id);
      log("info", "background step done", { step: step.id, module });
      return "done";
    } catch (error) {
      if (held.signal.aborted) return await this.suspend({ step, runId, lost: held.lost() });
      return await this.recordFailure({ step, runId, error });
    } finally {
      held.stop();
      if (!held.lost()) await ledger.releaseLease({ name, owner: identity.owner });
    }
  }

  /** The lease's renewal timer and the step's own signal, aborted by the sweep or a lost lease. */
  private holdLease({
    name,
    ttlMs,
    signal,
    step,
  }: {
    name: string;
    ttlMs: number;
    signal: AbortSignal;
    step: string;
  }) {
    const { ledger, identity, log } = this.options;
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
    const renew = async () => {
      try {
        const renewed = await ledger.renewLease({ name, owner: identity.owner, ttlMs });
        if (!renewed) lose("another worker holds the lease");
      } catch (error) {
        lose(`the lease could not be renewed: ${messageOf(error)}`);
      }
    };
    const timer = setInterval(
      () => void renew(),
      this.options.renewEveryMs ?? BACKGROUND_STEP_RENEW_EVERY_MS,
    );
    timer.unref?.();
    return {
      signal: controller.signal,
      lost: () => lost,
      stop: () => {
        clearInterval(timer);
        signal.removeEventListener("abort", onStop);
      },
    };
  }

  /** A stopped run returns its step to pending; a lost lease leaves the row to the new holder. */
  private async suspend({
    step,
    runId,
    lost,
  }: {
    step: MigrationStep;
    runId: string;
    lost: boolean;
  }): Promise<"held"> {
    if (!lost) await this.options.ledger.setStatus({ ids: [step.id], status: "pending", runId });
    this.options.log("info", "background step stopped; it resumes from its checkpoint", {
      step: step.id,
      module: moduleOf(step.id),
      leaseLost: lost,
    });
    return "held";
  }

  /** Pending again after a backoff while attempts remain; then failed, with an alert. */
  private async recordFailure({
    step,
    runId,
    error,
  }: {
    step: MigrationStep;
    runId: string;
    error: unknown;
  }): Promise<"failed" | "retrying"> {
    const { ledger, log } = this.options;
    const retry = this.options.retry ?? BACKGROUND_STEP_RETRY;
    const lastError = messageOf(error);
    const attempt = (this.failures.get(step.id)?.count ?? 0) + 1;
    const fields = { step: step.id, module: moduleOf(step.id), error: lastError, attempt };
    if (attempt < retry.attempts) {
      const retryInMs = Math.min(retry.firstBackoffMs * 2 ** (attempt - 1), retry.maxBackoffMs);
      this.failures.set(step.id, { count: attempt, retryAt: this.now() + retryInMs });
      await ledger.setStatus({ ids: [step.id], status: "pending", runId, lastError });
      log("warn", "background step failed; retrying after a backoff", { ...fields, retryInMs });
      return "retrying";
    }
    this.failures.delete(step.id);
    await ledger.setStatus({ ids: [step.id], status: "failed", runId, lastError });
    log("warn", "background step failed", {
      ...fields,
      attempts: retry.attempts,
      alert: true,
      next: "fix the cause; the next `pnpm task upgrade` run sets it pending again",
    });
    return "failed";
  }
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
