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
    status: "done" | "failed";
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
}>;

/** A crashed worker's lease frees itself after this; a live run renews it as it saves. */
export const BACKGROUND_STEP_LEASE_TTL_MS = 120_000;

/** How often the worker looks for a background step to run. */
export const BACKGROUND_SWEEP_EVERY_MS = 30_000;

/** Pending or left running by a dead worker: what a pass may pick up. */
const RUNNABLE = new Set<UpgradeStep["status"]>(["pending", "running"]);

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
}

/**
 * Runs the background steps the worker's modules declare (ADR-173 §1, round 14: the framework
 * runs). One step at a time under its own lease, only while the process serves, and a step that
 * needs old writers gone only once the serving roster says so. Spec: background-steps.feature.
 */
export class BackgroundStepsService {
  private constructor(private readonly options: BackgroundStepsOptions) {}

  static create(options: BackgroundStepsOptions): BackgroundStepsService {
    return new BackgroundStepsService(options);
  }

  /** One pass over the declared steps in declaration order; never throws for a step's failure. */
  async sweep({ signal }: { signal: AbortSignal }): Promise<BackgroundSweep> {
    const ran: string[] = [];
    const failed: string[] = [];
    const waiting: string[] = [];
    const declared = this.options.steps.filter((step) => step.mode === "background");
    if (declared.length === 0) return { paused: false, ran, failed, waiting };
    const rows = new Map((await this.options.ledger.findSteps()).map((row) => [row.id, row]));
    const by = { done: ran, failed, waiting } as const;
    for (const step of declared) {
      if (signal.aborted) break;
      if (!this.options.serving()) return { paused: true, ran, failed, waiting };
      const outcome = await this.sweepOne({ step, row: rows.get(step.id), signal });
      if (outcome !== "skipped" && outcome !== "held") by[outcome].push(step.id);
    }
    return { paused: false, ran, failed, waiting };
  }

  private async sweepOne({
    step,
    row,
    signal,
  }: {
    step: MigrationStep;
    row: Pick<UpgradeStep, "status" | "report"> | undefined;
    signal: AbortSignal;
  }): Promise<"done" | "failed" | "held" | "waiting" | "skipped"> {
    if (!row || !RUNNABLE.has(row.status)) return "skipped";
    const gone =
      !step.needsOldWritersGone || (await this.options.oldWritersGoneFor({ stepId: step.id }));
    if (!gone) return "waiting";
    return this.runLeased({ step, resumeFrom: row.report ?? null, signal });
  }

  private async runLeased({
    step,
    resumeFrom,
    signal,
  }: {
    step: MigrationStep;
    resumeFrom: MigrationStepReport | null;
    signal: AbortSignal;
  }): Promise<"done" | "failed" | "held"> {
    const { ledger, identity, log } = this.options;
    const ttlMs = this.options.leaseTtlMs ?? BACKGROUND_STEP_LEASE_TTL_MS;
    const name = `background:${step.id}`;
    const lease = await ledger.acquireLease({ name, ttlMs, ...identity });
    if (!lease) return "held";
    const module = moduleOf(step.id);
    const runId = `background:${identity.owner}`;
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
            await ledger.saveReport({ id: step.id, report: saved });
            await ledger.renewLease({ name, owner: identity.owner, ttlMs });
          },
        },
        dryRun: false,
        signal,
      });
      await ledger.setStatus({ ids: [step.id], status: "done", runId, report });
      log("info", "background step done", { step: step.id, module });
      return "done";
    } catch (error) {
      if (signal.aborted) return "held";
      const lastError = messageOf(error);
      await ledger.setStatus({ ids: [step.id], status: "failed", runId, lastError });
      log("warn", "background step failed", { step: step.id, module, error: lastError });
      return "failed";
    } finally {
      await ledger.releaseLease({ name, owner: identity.owner });
    }
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
