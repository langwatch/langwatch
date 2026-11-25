import type { Logger } from "@langwatch/observability";

import { observeEsProcessWakeLag } from "../../metrics.ts";
import { ProcessStateUnreadableError, toSafeFailureDiagnostic } from "../failureDiagnostic.ts";
import type { HandleResult } from "../processManagerService.ts";
import type { DueWake, ProcessStore } from "../stores/processStore.types.ts";

/**
 * How far a claim moves a due wake's nextWakeAt ahead, keeping it out of other workers' scans.
 * A commit replaces it and a failed handler releases it; only a crashed worker's claim runs to
 * the end, so its wakes fire about a minute late. Twelve 5s polls: a normal batch fits easily.
 */
export const WAKE_CLAIM_LEASE_MS = 60_000;

/** A wake starts only while this much of the claim remains, so its handling ends inside it. */
export const WAKE_CLAIM_SAFETY_MARGIN_MS = WAKE_CLAIM_LEASE_MS * 0.2;

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 20;

/** The slice of ProcessManagerService a wake needs. */
export interface ProcessWakeHandler {
  handleWake(params: { wake: DueWake; now: number }): Promise<HandleResult>;
}

export interface ProcessWakeWorkerOptions {
  store: Pick<ProcessStore, "leaseDueWakes" | "releaseWakeClaim">;
  /**
   * One handler per processName. A scan claims only these names, so a wake of
   * a process not composed here stays due, untouched, for a worker that is.
   */
  managers: Record<string, ProcessWakeHandler>;
  logger: Logger;
  /** Best-effort drain nudge for the woken process's own outbox after it inserted intents. */
  notifyOutbox?: (processName: string) => void;
  intervalMs?: number;
  batchSize?: number;
  now?: () => number;
}

/** Polling loop for process wake-ups: each scan claims a batch no other worker is handed. */
export class ProcessWakeWorker {
  private readonly store: Pick<ProcessStore, "leaseDueWakes" | "releaseWakeClaim">;
  private readonly managers: Record<string, ProcessWakeHandler>;
  private readonly logger: Logger;
  private readonly notifyOutbox: ((processName: string) => void) | undefined;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly now: () => number;

  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private started = false;

  constructor(options: ProcessWakeWorkerOptions) {
    this.store = options.store;
    this.managers = options.managers;
    this.logger = options.logger;
    this.notifyOutbox = options.notifyOutbox;
    this.intervalMs = Math.max(1, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.now = options.now ?? Date.now;
  }

  /** Starts an immediate scan plus the recovery poll. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => this.triggerScan(), this.intervalMs);
    this.timer.unref();
    this.triggerScan();
    this.logger.info(
      {
        intervalMs: this.intervalMs,
        batchSize: this.batchSize,
        processNames: Object.keys(this.managers),
      },
      "ProcessWakeWorker started",
    );
  }

  /** Stops future polls and waits for the current scan, if any. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
    this.logger.info({}, "ProcessWakeWorker stopped");
  }

  private triggerScan(): void {
    if (!this.started) return;
    // Do not overlap scans: a second scan would claim another batch while
    // this one is still working through the batch it holds a claim on.
    if (this.inFlight !== null) return;
    const scan = this.runScan();
    this.inFlight = scan;
    void scan.finally(() => {
      if (this.inFlight === scan) this.inFlight = null;
    });
  }

  private async runScan(): Promise<void> {
    try {
      const claimedAt = this.now();
      const claimedUntil = claimedAt + WAKE_CLAIM_LEASE_MS;
      const due = await this.store.leaseDueWakes({
        now: claimedAt,
        limit: this.batchSize,
        leaseDurationMs: WAKE_CLAIM_LEASE_MS,
        processNames: Object.keys(this.managers),
      });
      for (const [index, wake] of due.entries()) {
        if (this.now() >= claimedUntil - WAKE_CLAIM_SAFETY_MARGIN_MS) {
          this.logger.warn(
            { unhandled: due.length - index, leaseMs: WAKE_CLAIM_LEASE_MS },
            "Wake claim is inside its safety margin; releasing the rest of the batch for a later poll",
          );
          for (const unhandled of due.slice(index)) await this.release(unhandled, claimedUntil);
          return;
        }
        await this.handleOne(wake, claimedUntil);
      }
    } catch (error) {
      const { errorType, errorMessage } = toSafeFailureDiagnostic(error);
      this.logger.warn(
        { errorType, errorMessage },
        "ProcessWakeWorker scan failed; the next poll will retry",
      );
    }
  }

  private async handleOne(wake: DueWake, claimedUntil: number): Promise<void> {
    const manager = this.managers[wake.ref.processName];
    if (!manager) {
      this.logger.warn(
        { processName: wake.ref.processName, projectId: wake.ref.projectId },
        "Due wake has no registered process manager; skipping",
      );
      await this.release(wake, claimedUntil);
      return;
    }
    try {
      const now = this.now();
      // Scheduled-instant → handling delay (ADR-054): the substrate's
      // direct "is the scheduler stalling" signal. Observed before the
      // evolution so a failing handler still records how late we were.
      observeEsProcessWakeLag({
        processName: wake.ref.processName,
        lagMs: now - wake.wakeAt,
      });
      const result = await manager.handleWake({ wake, now });
      if (result.outcome === "committed" && result.insertedMessageKeys.length > 0) {
        this.notifyOutbox?.(wake.ref.processName);
      }
      // staleWake / revisionConflict: another commit advanced the process
      // since this wake was scheduled — it stands down silently.
    } catch (error) {
      // The claim goes back, so the next poll retries the wake from its due time.
      const { errorType, errorMessage } = toSafeFailureDiagnostic(error);
      this.logger.warn(
        {
          processName: wake.ref.processName,
          projectId: wake.ref.projectId,
          processKey: wake.ref.processKey,
          errorType,
          errorMessage,
          ...(error instanceof ProcessStateUnreadableError ? { issuePaths: error.issuePaths } : {}),
        },
        "Wake handling failed; the next poll will retry",
      );
      await this.release(wake, claimedUntil);
    }
  }

  /**
   * Hands an unhandled claim back so the wake is due again at its own time: the overdue gauge
   * and the wake-lag histogram keep seeing it. A failed release lets the claim lapse instead.
   */
  private async release(wake: DueWake, claimedUntil: number): Promise<void> {
    try {
      await this.store.releaseWakeClaim({
        ref: wake.ref,
        revision: wake.revision,
        wakeAt: wake.wakeAt,
        claimedUntil,
      });
    } catch (error) {
      const { errorType, errorMessage } = toSafeFailureDiagnostic(error);
      this.logger.warn(
        {
          processName: wake.ref.processName,
          projectId: wake.ref.projectId,
          processKey: wake.ref.processKey,
          errorType,
          errorMessage,
        },
        "Wake claim release failed; the wake fires again when its claim lapses",
      );
    }
  }
}
