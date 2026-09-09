import { createLogger } from "@langwatch/observability";
import type { ReplayRepository } from "../repositories/replay.repository.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:ops:replay-lock-heartbeat");

const REPLAY_LOCK_TTL_SECONDS = 3600;

/**
 * How often a running replay re-extends its lock, on a timer of its own. Running independently of
 * progress callbacks keeps the lock alive even when a single batch phase emits nothing for longer
 * than the lock's lifetime, whose expiry used to silently stop status updates mid-run.
 */
export const LOCK_REFRESH_INTERVAL_MS = 60_000;

/** How long a progress callback may go without re-reading the cancel flag. */
const CANCEL_CHECK_INTERVAL_MS = 3000;

/**
 * The lock and cancel watch a single replay run holds. It keeps the run's lock alive, notices a
 * cancel request, and notices a takeover by another run — all three answered through one
 * `cancelled` flag, because for this run they mean the same thing: stop.
 */
export class ReplayLockHeartbeatService {
  static create({
    repo,
    runId,
  }: {
    repo: ReplayRepository;
    runId: string;
  }): ReplayLockHeartbeatService {
    return new ReplayLockHeartbeatService(repo, runId);
  }

  private constructor(
    private readonly repo: ReplayRepository,
    private readonly runId: string,
  ) {}

  private timer: NodeJS.Timeout | null = null;
  private lastCheck = nowInstant().epochMilliseconds;
  private stopped = false;

  /** Whether this run should stop, because it was cancelled or lost its lock. */
  get cancelled(): boolean {
    return this.stopped;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.refreshLock();
      this.pollCancelled();
    }, LOCK_REFRESH_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Re-reads the cancel flag, at most once per interval, for callers on the progress path. The
   * throttle is what keeps a chatty projection from turning every callback into a Redis read.
   */
  pollCancelledThrottled(): void {
    const now = nowInstant().epochMilliseconds;
    if (now - this.lastCheck <= CANCEL_CHECK_INTERVAL_MS) {
      return;
    }

    this.lastCheck = now;
    this.repo
      .isCancelled()
      .then((cancelled) => {
        if (cancelled) {
          this.stopped = true;
        }
      })
      .catch(() => {});
  }

  private refreshLock(): void {
    this.repo
      .refreshLock({ runId: this.runId, ttlSeconds: REPLAY_LOCK_TTL_SECONDS })
      .then((stillHeld) => {
        if (stillHeld) {
          return;
        }

        // The lock is confirmed gone, so there is nothing left to refresh and no point re-warning
        // every interval: warn once and stop the timer.
        logger.warn(
          { runId: this.runId },
          "Replay lock lost to another run; aborting stale replay",
        );
        this.stopped = true;
        this.stop();
      })
      .catch((err) => {
        logger.warn({ error: err }, "Failed to refresh replay lock");
      });
  }

  private pollCancelled(): void {
    this.repo
      .isCancelled()
      .then((cancelled) => {
        if (cancelled) {
          this.stopped = true;
        }
      })
      .catch((err) => {
        logger.warn({ error: err }, "Failed to poll replay cancel flag");
      });
  }
}
