import type { Logger } from "@langwatch/observability";

import { incrementEsProcessOutboxStuckDrains } from "~/server/metrics";
import type { OutboxDispatcherService } from "./outboxDispatcherService";

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_STUCK_DRAIN_TIMEOUT_MS = 300_000;
/**
 * How many abandoned drains may still be pending before the worker stops
 * starting new ones. Abandonment frees the polling loop but cannot cancel the
 * drain: `runOnce` has no abort path, so a permanently hung delivery keeps its
 * leased batch and its promise chain alive for the life of the pod. Past this
 * many, every drain this worker starts is hanging, and starting more only
 * retains more batches while the same handler hangs again.
 */
const MAX_ABANDONED_DRAINS = 5;

export interface ProcessOutboxWorkerOptions {
  dispatcher: Pick<OutboxDispatcherService, "runOnce">;
  logger: Logger;
  /** Process-manager name, used to label stuck-drain metrics and logs. */
  name?: string;
  intervalMs?: number;
  batchSize?: number;
  /**
   * How long one drain may run before the worker declares it stuck,
   * abandons it, and resumes polling. Generous by design — legitimately
   * slow domains must never trip it — because the alternative was worse:
   * a single never-settling delivery held `inFlight` for the life of the
   * pod and silently wedged this process manager until the next rollout
   * (issue #7016). The abandoned drain's late acknowledgements are fenced
   * by their lapsed leases, so abandonment is correct; it does not cancel
   * the drain, which is why `MAX_ABANDONED_DRAINS` bounds how many may be
   * retained at once.
   */
  stuckDrainTimeoutMs?: number;
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
  private readonly name: string;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly stuckDrainTimeoutMs: number;
  private readonly now: () => number;

  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  /** A producer notified while the current lease/drain was already running. */
  private drainRequested = false;
  private started = false;
  /** Drains the watchdog abandoned that have still not settled. */
  private abandonedDrains = 0;
  private isRefusingToDrain = false;

  constructor(options: ProcessOutboxWorkerOptions) {
    this.dispatcher = options.dispatcher;
    this.logger = options.logger;
    this.name = options.name ?? "unknown";
    this.intervalMs = Math.max(1, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.stuckDrainTimeoutMs = Math.max(
      1,
      options.stuckDrainTimeoutMs ?? DEFAULT_STUCK_DRAIN_TIMEOUT_MS,
    );
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

  /**
   * Stops future polls and waits for the current drain, if any. Drains the
   * watchdog already abandoned are not awaited: they are the ones that never
   * settle, so awaiting them would hold shutdown open forever.
   */
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
    if (this.abandonedDrains >= MAX_ABANDONED_DRAINS) {
      if (!this.isRefusingToDrain) {
        this.isRefusingToDrain = true;
        this.logger.error(
          {
            processName: this.name,
            abandonedDrains: this.abandonedDrains,
          },
          "ProcessOutboxWorker has abandoned too many drains without any of " +
            "them settling; refusing to start another. Deliveries in this " +
            "domain are hanging and the process manager needs attention.",
        );
      }
      return;
    }
    if (this.inFlight !== null) {
      // Do not overlap local drains, but do not lose a producer notification
      // that may describe work committed after the current lease query.
      this.drainRequested = true;
      return;
    }
    const drain = this.runDrain();
    this.inFlight = drain;
    // The watchdog belongs to THIS drain, so an abandoned drain settling
    // late can never disarm its successor's watchdog.
    const watchdog = setTimeout(() => {
      if (this.inFlight !== drain) return;
      // Abandon the stuck drain: clear the single-flight slot so polling
      // resumes. The drain's `finally` guard sees `inFlight !== drain` when
      // it eventually settles, and any acknowledgement it still makes is
      // fenced by its lapsed lease (and counted as such).
      this.inFlight = null;
      this.abandonedDrains += 1;
      incrementEsProcessOutboxStuckDrains({ processName: this.name });
      this.logger.error(
        {
          processName: this.name,
          stuckDrainTimeoutMs: this.stuckDrainTimeoutMs,
          abandonedDrains: this.abandonedDrains,
        },
        "ProcessOutboxWorker drain did not settle within the stuck-drain " +
          "threshold — abandoning it and resuming polling. A delivery in " +
          "this domain is not settling.",
      );
      if (this.drainRequested) {
        this.drainRequested = false;
        this.triggerDrain();
      }
    }, this.stuckDrainTimeoutMs);
    watchdog.unref();
    void drain.finally(() => {
      clearTimeout(watchdog);
      if (this.inFlight !== drain) {
        // An abandoned drain settled after all: it no longer retains its
        // batch, so give its slot back and let polling recover on its own.
        this.abandonedDrains = Math.max(0, this.abandonedDrains - 1);
        if (this.abandonedDrains < MAX_ABANDONED_DRAINS) {
          this.isRefusingToDrain = false;
        }
        return;
      }
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
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "ProcessOutboxWorker drain failed; the next poll will retry",
      );
    }
  }
}
