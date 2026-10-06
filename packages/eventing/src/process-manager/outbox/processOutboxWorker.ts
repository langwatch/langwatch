import type { Logger } from "@langwatch/observability";

import { incrementEsProcessOutboxStuckDrains } from "../../metrics.ts";
import type { DispatchReport, OutboxDispatcherService } from "./outboxDispatcherService.ts";

const DEFAULT_INTERVAL_MS = 1_000;
/** Ceiling for the idle backoff; a notify() resets the poll to `intervalMs`. */
const DEFAULT_MAX_IDLE_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_STUCK_DRAIN_TIMEOUT_MS = 300_000;
/**
 * How many abandoned drains may still be pending before the worker stops
 * starting new ones. `runOnce` has no abort path, so a hung delivery keeps
 * its batch alive for the pod's life, and starting more only piles up more.
 */
const MAX_ABANDONED_DRAINS = 5;

/** A drain that leased nothing; a failed or unreported drain is never idle. */
function leasedNothing(report: DispatchReport | undefined): boolean {
  if (!report) return false;
  const { dispatched, retried, dead, released, fenced } = report;
  return [dispatched, retried, dead, released, fenced].every((keys) => keys.length === 0);
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

export interface ProcessOutboxWorkerOptions {
  dispatcher: Pick<OutboxDispatcherService, "runOnce">;
  logger: Logger;
  /** Process-manager name, used to label stuck-drain metrics and logs. */
  name?: string;
  intervalMs?: number;
  /** Each poll that leases nothing doubles the interval up to this ceiling. */
  maxIdleIntervalMs?: number;
  batchSize?: number;
  /** Stuck drain timeout; generous to avoid false positives that wedge processing. */
  stuckDrainTimeoutMs?: number;
  /**
   * Fraction of one interval, in [0, 1), by which this worker's recovery poll
   * is phase-shifted — an unphased fleet leases in lockstep and contends for
   * the same Postgres connections forever; the default spreads polls instead.
   */
  jitter?: () => number;
  now?: () => number;
}

/**
 * Polling loop for the transactional process outbox. Postgres leasing in the
 * dispatcher coordinates multiple instances; this class only owns local
 * lifecycle, recovery polling, and single-flight execution.
 */
export class ProcessOutboxWorker {
  private readonly dispatcher: Pick<OutboxDispatcherService, "runOnce">;
  private readonly logger: Logger;
  private readonly name: string;
  private readonly intervalMs: number;
  private readonly maxIdleIntervalMs: number;
  /** The delay the next recovery poll is armed with: `intervalMs` doubled per idle drain. */
  private pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly stuckDrainTimeoutMs: number;
  private readonly jitter: () => number;
  private readonly now: () => number;

  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<DispatchReport | undefined> | null = null;
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
    this.maxIdleIntervalMs = Math.max(
      this.intervalMs,
      options.maxIdleIntervalMs ?? DEFAULT_MAX_IDLE_INTERVAL_MS,
    );
    this.pollIntervalMs = this.intervalMs;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.stuckDrainTimeoutMs = Math.max(
      1,
      options.stuckDrainTimeoutMs ?? DEFAULT_STUCK_DRAIN_TIMEOUT_MS,
    );
    this.jitter = options.jitter ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  /** Starts an immediate drain plus the phase-shifted recovery poll. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.pollIntervalMs = this.intervalMs;
    const phaseMs = Math.floor(clampFraction(this.jitter()) * this.intervalMs);
    this.armPoll(phaseMs + this.intervalMs);
    this.triggerDrain();
    this.logger.info(
      { intervalMs: this.intervalMs, batchSize: this.batchSize, phaseMs },
      "ProcessOutboxWorker started",
    );
  }

  /**
   * Nudges the worker after a producer commits new outbox work. The periodic
   * poll remains the crash/restart recovery path; notifications only remove
   * avoidable latency from the healthy path, and end any idle backoff.
   */
  notify(): void {
    this.endIdleBackoff();
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.inFlight;
    this.logger.info({}, "ProcessOutboxWorker stopped");
  }

  /** One recovery poll: drain, then re-arm with the interval as it stands now. */
  private armPoll(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.started) return;
      this.triggerDrain();
      this.armPoll(this.pollIntervalMs);
    }, delayMs);
    this.timer.unref();
  }

  /** Back to `intervalMs`, re-arming a poll that was armed with a longer idle delay. */
  private endIdleBackoff(): void {
    if (this.pollIntervalMs === this.intervalMs) return;
    this.pollIntervalMs = this.intervalMs;
    if (this.started) this.armPoll(this.intervalMs);
  }

  private settleBackoff(report: DispatchReport | undefined): void {
    if (leasedNothing(report)) {
      this.pollIntervalMs = Math.min(this.pollIntervalMs * 2, this.maxIdleIntervalMs);
      return;
    }
    this.endIdleBackoff();
  }

  private triggerDrain(): void {
    if (!this.started) return;
    if (this.abandonedDrains >= MAX_ABANDONED_DRAINS) {
      this.refuseToDrain();
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
    const watchdog = setTimeout(() => this.abandonStuckDrain(drain), this.stuckDrainTimeoutMs);
    watchdog.unref();
    void drain.then((report) => this.settleDrain({ drain, watchdog, report }));
  }

  private refuseToDrain(): void {
    if (this.isRefusingToDrain) return;
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

  private abandonStuckDrain(drain: Promise<DispatchReport | undefined>): void {
    if (this.inFlight !== drain) return;
    // Abandon the stuck drain: clear the single-flight slot so polling
    // resumes at the base interval. The drain's `finally` guard sees `inFlight !== drain` when
    // it eventually settles, and any acknowledgement it still makes is
    // fenced by its lapsed lease (and counted as such).
    this.inFlight = null;
    this.abandonedDrains += 1;
    this.endIdleBackoff();
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
  }

  private settleDrain({
    drain,
    watchdog,
    report,
  }: {
    drain: Promise<DispatchReport | undefined>;
    watchdog: NodeJS.Timeout;
    report: DispatchReport | undefined;
  }): void {
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
    if (this.started) this.settleBackoff(report);
    if (this.drainRequested) {
      this.drainRequested = false;
      this.triggerDrain();
    }
  }

  private async runDrain(): Promise<DispatchReport | undefined> {
    try {
      return await this.dispatcher.runOnce({
        now: this.now(),
        limit: this.batchSize,
      });
    } catch (error) {
      this.logger.warn({ error }, "ProcessOutboxWorker drain failed; the next poll will retry");
      return undefined;
    }
  }
}
