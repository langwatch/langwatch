import type { Logger } from "@langwatch/observability";

import type { OutboxDispatcherService } from "./outboxDispatcherService";

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 10;

export interface ProcessOutboxWorkerOptions {
  dispatcher: Pick<OutboxDispatcherService, "runOnce">;
  logger: Logger;
  intervalMs?: number;
  batchSize?: number;
  now?: () => number;
}

/**
 * Polling loop for the transactional process outbox. Postgres leasing in the
 * dispatcher coordinates multiple instances; this class only owns local
 * lifecycle, recovery polling, and single-flight execution. Composition owns
 * deciding which process roles call start().
 */
export class ProcessOutboxWorker {
  private readonly dispatcher: Pick<OutboxDispatcherService, "runOnce">;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly now: () => number;

  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  /** A producer notified while the current lease/drain was already running. */
  private drainRequested = false;
  private started = false;

  constructor(options: ProcessOutboxWorkerOptions) {
    this.dispatcher = options.dispatcher;
    this.logger = options.logger;
    this.intervalMs = Math.max(1, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.now = options.now ?? Date.now;
  }

  /** Starts an immediate drain plus the recovery poll. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.timer = setInterval(() => this.triggerDrain(), this.intervalMs);
    this.timer.unref();
    this.triggerDrain();
    this.logger.info(
      { intervalMs: this.intervalMs, batchSize: this.batchSize },
      "ProcessOutboxWorker started",
    );
  }

  /**
   * Nudges the worker after a producer commits new outbox work. The periodic
   * poll remains the crash/restart recovery path; notifications only remove
   * avoidable latency from the healthy path.
   */
  notify(): void {
    this.triggerDrain();
  }

  /** Stops future polls and waits for the current drain, if any. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.drainRequested = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
    this.logger.info({}, "ProcessOutboxWorker stopped");
  }

  private triggerDrain(): void {
    if (!this.started) return;
    if (this.inFlight) {
      // Do not overlap local drains, but do not lose a producer notification
      // that may describe work committed after the current lease query.
      this.drainRequested = true;
      return;
    }
    const drain = this.runDrain();
    this.inFlight = drain;
    void drain.finally(() => {
      if (this.inFlight !== drain) return;
      this.inFlight = null;
      if (this.drainRequested) {
        this.drainRequested = false;
        this.triggerDrain();
      }
    });
  }

  private async runDrain(): Promise<void> {
    try {
      await this.dispatcher.runOnce({
        now: this.now(),
        limit: this.batchSize,
      });
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "ProcessOutboxWorker drain failed; the next poll will retry",
      );
    }
  }
}
