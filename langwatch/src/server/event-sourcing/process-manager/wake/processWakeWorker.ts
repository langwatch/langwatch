import type { Logger } from "@langwatch/observability";

import type { HandleResult } from "../processManagerService";
import type { DueWake, ProcessStore } from "../stores/processStore.types";

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_SIZE = 20;

/** The slice of ProcessManagerService a wake needs. */
export interface WakeHandlerPort {
  handleWake(params: { wake: DueWake; now: number }): Promise<HandleResult>;
}

export interface ProcessWakeWorkerOptions {
  store: Pick<ProcessStore, "findDueWakes">;
  /**
   * One handler per processName. A due wake whose processName has no
   * registered handler is logged and skipped — its nextWakeAt stays put, so
   * it surfaces on every scan until the owning process is composed in (the
   * same log-and-skip posture the calendar scheduler takes for orphan
   * targetTypes).
   */
  managers: Record<string, WakeHandlerPort>;
  logger: Logger;
  /** Best-effort drain nudge after a committed wake inserted intents. */
  notifyOutbox?: () => void;
  intervalMs?: number;
  batchSize?: number;
  now?: () => number;
}

/**
 * Polling loop for due process wake-ups (ADR-051; the first production
 * caller of `findDueWakes`). No leader election is needed: `handleWake`
 * commits with the revision the wake was scheduled at, so when two workers
 * race the same wake exactly one commit wins — the loser observes
 * `staleWake`/`revisionConflict` and stands down. This class only owns local
 * lifecycle, recovery polling, and single-flight execution; composition owns
 * deciding which process roles call start().
 */
export class ProcessWakeWorker {
  private readonly store: Pick<ProcessStore, "findDueWakes">;
  private readonly managers: Record<string, WakeHandlerPort>;
  private readonly logger: Logger;
  private readonly notifyOutbox: (() => void) | undefined;
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
    // Do not overlap scans: due rows only leave the scan set when a commit
    // moves nextWakeAt, so a slow scan re-finding the same wakes is wasted
    // work the revision fence would reject anyway.
    if (this.inFlight) return;
    const scan = this.runScan();
    this.inFlight = scan;
    void scan.finally(() => {
      if (this.inFlight === scan) this.inFlight = null;
    });
  }

  private async runScan(): Promise<void> {
    try {
      const now = this.now();
      const due = await this.store.findDueWakes({
        now,
        limit: this.batchSize,
        processNames: Object.keys(this.managers),
      });
      for (const wake of due) {
        await this.handleOne(wake);
      }
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "ProcessWakeWorker scan failed; the next poll will retry",
      );
    }
  }

  private async handleOne(wake: DueWake): Promise<void> {
    const manager = this.managers[wake.ref.processName];
    if (!manager) {
      this.logger.warn(
        { processName: wake.ref.processName, projectId: wake.ref.projectId },
        "Due wake has no registered process manager; skipping",
      );
      return;
    }
    try {
      const now = this.now();
      const result = await manager.handleWake({ wake, now });
      if (result.outcome === "committed") {
        if (result.insertedMessageKeys.length > 0) this.notifyOutbox?.();
      }
      // staleWake / revisionConflict: another commit advanced the process
      // since this wake was scheduled — it stands down silently.
    } catch (error) {
      // The wake stays due; the next poll retries it.
      this.logger.error(
        {
          processName: wake.ref.processName,
          projectId: wake.ref.projectId,
          processKey: wake.ref.processKey,
          error: error instanceof Error ? error.message : String(error),
        },
        "Wake handling failed; the next poll will retry",
      );
    }
  }
}
