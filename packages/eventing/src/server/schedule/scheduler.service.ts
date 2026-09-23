import { randomUUID } from "crypto";

import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { computeCatchUp, computeNextRunAt } from "./next-run-at.ts";
import type { SchedulerWakeRedis } from "./scheduler-wake.repository.ts";
import type { SchedulerRegistry } from "./scheduler.registry.ts";
import type { ScheduledJobRecord, ScheduledJobStore } from "./scheduler.types.ts";

/**
 * Best-effort cross-pod wake (ADR-044). Postgres is the correctness/locking
 * layer; Redis pub/sub is a fire-and-forget latency optimization only.
 */
const WAKE_CHANNEL = "scheduler:wake";

/**
 * Safety-net backstop: caps how long the loop sleeps even when idle, so a job
 * created on another pod is still picked up. ADR-044 §4.
 */
const DEFAULT_MAX_SLEEP_MS = 60_000;

/** Max due rows claimed per cycle — bounds one worker's per-cycle work. */
const DUE_SCAN_LIMIT = 100;

/**
 * Max time `stop()` waits for the loop to unwind before proceeding anyway,
 * matching the bounded shutdown budget used by the other worker loops.
 */
const SHUTDOWN_MAX_WAIT_MS = 10_000;

/** Backoff after an unexpected cycle error so a Postgres blip can't hot-spin. */
const LOOP_ERROR_BACKOFF_MS = 1_000;

/**
 * Lease window covering handler runtime; hides the slot from findDue to prevent
 * double-claiming, and serves as retry backoff if the worker crashes.
 */
const LEASE_MS = 10 * 60_000;

/**
 * Attempts before a slot is abandoned to the next cron instant — small enough
 * that a persistently-broken target can't retry forever, large enough to ride
 * out a transient blip.
 */
const MAX_ATTEMPTS = 5;

/** Base + cap for the bounded exponential retry backoff (see `backoffMs`). */
const BACKOFF_BASE_MS = 60_000; // 1 min — matches the ADR-044 60s calendar granularity
const BACKOFF_CAP_MS = 30 * 60_000; // 30 min — an upper bound if MAX_ATTEMPTS grows

export interface SchedulerServiceDeps {
  repo: ScheduledJobStore;
  registry: SchedulerRegistry;
  /**
   * Whether THIS process runs the worker stack. The composition root decides —
   * `roleRunsWorkers(processRole)` in the deployment's own config — because the
   * process-role enum is a deployment fact rather than an eventing one.
   */
  runsWorkers: boolean;
  logger: Logger;
  /** Intelligent-sleep backstop (default 60s). */
  maxSleepMs?: number;
  /**
   * Optional Redis for the best-effort cross-pod wake. Omit it and the
   * scheduler is 100% Postgres — correctness is identical, only cross-pod
   * reaction latency changes.
   */
  redis?: SchedulerWakeRedis | null;
}

/**
 * Postgres-only calendar scheduler: every worker races conditional leases to
 * fire slots exactly once; optional Redis pub/sub for cross-pod early-wake.
 */
export class SchedulerService {
  private readonly repo: ScheduledJobStore;
  private readonly registry: SchedulerRegistry;
  private readonly runsWorkers: boolean;
  private readonly logger: Logger;
  private readonly maxSleepMs: number;
  private readonly redis: SchedulerWakeRedis | null;
  private readonly workerId = randomUUID();

  /** Reset on every `start()` so a stop/start cycle gets a fresh signal. */
  private abortController = new AbortController();
  private loopPromise: Promise<void> | null = null;
  private started = false;
  /** Resolver for the current interruptible sleep; `wake()` pokes it. */
  private wakeCurrentSleep: (() => void) | null = null;
  /** Dedicated subscriber connection for the cross-pod wake (null = poll-only). */
  private subscriber: SchedulerWakeRedis | null = null;

  constructor(deps: SchedulerServiceDeps) {
    this.repo = deps.repo;
    this.registry = deps.registry;
    this.runsWorkers = deps.runsWorkers;
    this.logger = deps.logger;
    this.maxSleepMs = deps.maxSleepMs ?? DEFAULT_MAX_SLEEP_MS;
    this.redis = deps.redis ?? null;
  }

  /**
   * Best-effort cross-pod wake producer: signal every pod to re-scan now.
   * Fire-and-forget — a publish failure is swallowed since the poll backstop
   * still fires the job.
   */
  static publishWake(redis: SchedulerWakeRedis | null | undefined): void {
    if (!redis) return;
    void redis.publish(WAKE_CHANNEL, "1").catch(() => {
      // swallow — the poll backstop covers a missed wake (best-effort)
    });
  }

  /**
   * Producer wake: interrupt the current sleep so the loop re-scans NOW.
   * Cross-process producers rely on the poll backstop until a Postgres
   * LISTEN/NOTIFY wake lands. Safe to call whether or not sleeping.
   */
  wake(): void {
    this.wakeCurrentSleep?.();
  }

  /** Start the loop. No-op for roles without the worker stack; idempotent. */
  start(): void {
    if (!this.runsWorkers) {
      this.logger.debug(
        { runsWorkers: this.runsWorkers },
        "SchedulerService.start: role does not run the worker stack, skipping",
      );
      return;
    }
    if (this.started) return;
    this.started = true;
    if (this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }
    this.subscribeToWake();
    this.loopPromise = this.runLoop();
    this.logger.info(
      { workerId: this.workerId, crossPodWake: this.redis != null },
      "SchedulerService started",
    );
  }

  /**
   * Best-effort cross-pod wake consumer on its own dedicated subscriber
   * connection. All failures are swallowed — the poll backstop is the
   * correctness floor regardless of Redis.
   */
  private subscribeToWake(): void {
    if (!this.redis) return;
    try {
      const sub = this.redis.duplicate();
      sub.on("message", (channel: string) => {
        if (channel === WAKE_CHANNEL) this.wake();
      });
      sub.on("error", (err: Error) => {
        this.logger.debug(
          { workerId: this.workerId, error: err.message },
          "SchedulerService: wake subscriber error (poll backstop still active)",
        );
      });
      void sub.subscribe(WAKE_CHANNEL).catch((err: unknown) => {
        this.logger.debug(
          {
            workerId: this.workerId,
            error: err instanceof Error ? err.message : String(err),
          },
          "SchedulerService: wake subscribe failed (poll backstop still active)",
        );
      });
      this.subscriber = sub;
    } catch (err) {
      this.logger.debug(
        {
          workerId: this.workerId,
          error: err instanceof Error ? err.message : String(err),
        },
        "SchedulerService: could not set up wake subscriber (poll backstop still active)",
      );
    }
  }

  /**
   * Stop the loop. Aborts (which resolves any in-flight sleep immediately),
   * then waits — bounded — for the loop to unwind.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.abortController.abort();
    // Unblock a sleeping loop right away.
    this.wakeCurrentSleep?.();

    // Tear down the best-effort wake subscriber (its own connection).
    if (this.subscriber) {
      const sub = this.subscriber;
      this.subscriber = null;
      try {
        sub.disconnect();
      } catch (error) {
        // best-effort teardown
        void error;
      }
    }

    if (this.loopPromise !== null) {
      const settled = await Promise.race([
        this.loopPromise.then(() => true),
        new Promise<false>((resolve) =>
          setTimeout(() => resolve(false), SHUTDOWN_MAX_WAIT_MS).unref(),
        ),
      ]);
      if (!settled) {
        this.logger.warn(
          { workerId: this.workerId, timeoutMs: SHUTDOWN_MAX_WAIT_MS },
          "SchedulerService.stop: loop did not unwind within timeout — proceeding anyway",
        );
      }
    }

    this.loopPromise = null;
    this.logger.info({ workerId: this.workerId }, "SchedulerService stopped");
  }

  private async runLoop(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      try {
        await this.runCycle();
      } catch (error) {
        if (this.abortController.signal.aborted) break;
        this.logger.error(
          {
            workerId: this.workerId,
            error: error instanceof Error ? error.message : String(error),
          },
          "SchedulerService: cycle failed",
        );
        // Back off so a sustained Postgres failure can't spin the loop hot.
        await this.interruptibleSleep(LOOP_ERROR_BACKOFF_MS);
      }
    }
  }

  private async runCycle(): Promise<void> {
    // 1. Sleep until the soonest due job (intelligent sleep, capped by the
    //    backstop), interruptible by wake()/stop().
    const earliest = await this.repo.earliestActiveNextRunAt();
    await this.interruptibleSleep(this.sleepMsUntil(earliest));
    if (this.abortController.signal.aborted) return;

    // 2. Every worker scans + claims — no leader gate. The per-row conditional
    //    claim (below) is the exactly-once guarantee, so concurrent workers
    //    simply share the firing load (ADR-044 §4).
    await this.fireDueJobs();
  }

  /** Clamp (earliest − now) into [0, maxSleepMs]; full backstop when idle. */
  private sleepMsUntil(earliest: Date | null): number {
    if (!earliest) return this.maxSleepMs;
    const untilDueMs = earliest.getTime() - nowInstant().epochMilliseconds;
    if (untilDueMs <= 0) return 0;
    return Math.min(this.maxSleepMs, untilDueMs);
  }

  private async fireDueJobs(): Promise<void> {
    const now = new Date();
    const due = await this.repo.findDue({ now, limit: DUE_SCAN_LIMIT });
    for (const job of due) {
      if (this.abortController.signal.aborted) return;
      await this.fireJob({ job, now });
    }
  }

  private async fireJob({ job, now }: { job: ScheduledJobRecord; now: Date }): Promise<void> {
    // The lease is still conditioned on the row's CURRENT wake instant — that
    // is what `findDue` read and what a racing worker would also condition on.
    const claimAt = job.nextRunAt;

    // Compute slot and nextRunAt upfront to deactivate bad cron/tz before
    // leasing. RETRY: re-fire the pinned slot. FRESH: apply runLatest catch-up.
    let slot: Date;
    let nextSlot: Date;
    try {
      if (job.currentSlot) {
        slot = job.currentSlot;
        nextSlot = computeNextRunAt({
          cron: job.cron,
          timezone: job.timezone,
          after: slot,
        });
        if (nextSlot.getTime() <= now.getTime()) {
          nextSlot = computeNextRunAt({
            cron: job.cron,
            timezone: job.timezone,
            after: now,
          });
        }
      } else {
        const catchUp = computeCatchUp({
          cron: job.cron,
          timezone: job.timezone,
          slot: job.nextRunAt,
          now,
        });
        slot = catchUp.catchUpSlot;
        nextSlot = catchUp.nextRunAt;
      }
    } catch (error) {
      this.logger.error(
        {
          jobId: job.id,
          targetType: job.targetType,
          targetId: job.targetId,
          cron: job.cron,
          timezone: job.timezone,
          error: error instanceof Error ? error.message : String(error),
        },
        "SchedulerService: invalid cron/timezone — deactivating job",
      );
      await this.repo.deactivateForTarget({
        projectId: job.projectId,
        targetType: job.targetType,
        targetId: job.targetId,
      });
      return;
    }

    // ATOMIC LEASE: the conditional UPDATE only one worker's claim wins. The
    // winner pushes `nextRunAt` past the lease window without marking
    // delivered, so a failure retries and a crash re-fires on lease expiry —
    // the exactly-once guarantee for concurrent workers.
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const won = await this.repo.claim({
      id: job.id,
      projectId: job.projectId,
      expectedNextRunAt: claimAt,
      // Pin the slot we actually fire (the catch-up slot on a backlog), NOT the
      // WHERE-guard instant — so a retry re-fires this exact slot.
      slot,
      leaseUntil,
    });
    if (!won) {
      this.logger.debug(
        { jobId: job.id, slot: slot.toISOString() },
        "SchedulerService: slot already claimed by another worker, skipping",
      );
      return;
    }

    // We hold the lease. An unknown targetType has NOTHING to retry, so release
    // the lease by advancing to the next cron instant (leaving `lastSlot`
    // untouched — nothing was delivered) rather than leaving the row parked for
    // the whole lease window. Phase 1 registers no consumers, so the loop must
    // not crash on an orphan row (a report handler arrives in a later phase).
    const handler = this.registry.get(job.targetType);
    if (!handler) {
      this.logger.warn(
        { jobId: job.id, targetType: job.targetType },
        "SchedulerService: no handler registered for targetType, releasing slot",
      );
      await this.settle({
        job,
        leaseUntil,
        nextRunAt: nextSlot,
        lastSlot: job.lastSlot,
        currentSlot: null,
        attempts: 0,
        lastError: null,
        context: "release-unknown-handler",
      });
      return;
    }

    // Run the handler. On success, advance calendar and clear retry state.
    // On failure, retry per policy; crashes before settle cause at-least-once.
    try {
      await handler({
        projectId: job.projectId,
        targetType: job.targetType,
        targetId: job.targetId,
        slot,
      });
    } catch (error) {
      await this.handleFireFailure({ job, slot, nextSlot, leaseUntil, error });
      return;
    }

    await this.settle({
      job,
      leaseUntil,
      nextRunAt: nextSlot,
      lastSlot: slot,
      currentSlot: null,
      attempts: 0,
      lastError: null,
      context: "delivered",
    });
  }

  /**
   * Retry policy for a thrown handler (ADR-044). Under the cap the same slot
   * retries after a bounded backoff; at the cap it is abandoned to the next
   * cron instant, logged loudly so it is observable rather than silent.
   */
  private async handleFireFailure({
    job,
    slot,
    nextSlot,
    leaseUntil,
    error,
  }: {
    job: ScheduledJobRecord;
    slot: Date;
    nextSlot: Date;
    leaseUntil: Date;
    error: unknown;
  }): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.attempts;

    if (attempts + 1 < MAX_ATTEMPTS) {
      // Re-arm `nextRunAt` at a backoff instead of the lease's far edge, so the
      // retry fires promptly once the blip clears rather than after LEASE_MS.
      const retryAt = new Date(nowInstant().epochMilliseconds + this.backoffMs(attempts));
      this.logger.warn(
        {
          jobId: job.id,
          targetType: job.targetType,
          targetId: job.targetId,
          attempt: attempts + 1,
          retryAt: retryAt.toISOString(),
          error: message,
        },
        "SchedulerService: handler threw — retrying slot",
      );
      await this.settle({
        job,
        leaseUntil,
        nextRunAt: retryAt,
        lastSlot: job.lastSlot, // unchanged — the slot is retried, not delivered
        currentSlot: slot, // pin the calendar slot the retry must re-fire
        attempts: attempts + 1,
        lastError: message,
        context: "retry",
      });
      return;
    }

    // Cap reached: abandon THIS slot to the next cron instant. `lastSlot` stays
    // (it was never delivered), `attempts` resets for the next slot, `lastError`
    // is kept for the operator. The logger.error below makes it visible.
    this.logger.error(
      {
        jobId: job.id,
        targetType: job.targetType,
        targetId: job.targetId,
        slot: slot.toISOString(),
        attempts: MAX_ATTEMPTS,
        nextRunAt: nextSlot.toISOString(),
        error: message,
      },
      "SchedulerService: scheduled slot abandoned after max attempts",
    );
    await this.settle({
      job,
      leaseUntil,
      nextRunAt: nextSlot,
      lastSlot: job.lastSlot, // unchanged — the slot was never delivered
      currentSlot: null, // the slot is abandoned; the next fire is a fresh one
      attempts: 0,
      lastError: message,
      context: "abandon",
    });
  }

  /** Bounded exponential backoff for the Nth retry (0-based), capped. */
  private backoffMs(attempts: number): number {
    return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempts);
  }

  /**
   * Settle the lease via the repo's conditional writer. A `false` return means
   * the lease expired and another worker re-claimed the slot — correctness
   * still holds (at-least-once), but it is worth logging.
   */
  private async settle({
    job,
    leaseUntil,
    nextRunAt,
    lastSlot,
    currentSlot,
    attempts,
    lastError,
    context,
  }: {
    job: ScheduledJobRecord;
    leaseUntil: Date;
    nextRunAt: Date;
    lastSlot: Date | null;
    currentSlot: Date | null;
    attempts: number;
    lastError: string | null;
    context: string;
  }): Promise<void> {
    const settled = await this.repo.settleClaim({
      id: job.id,
      projectId: job.projectId,
      expectedLease: leaseUntil,
      nextRunAt,
      lastSlot,
      currentSlot,
      attempts,
      lastError,
    });
    if (!settled) {
      this.logger.warn(
        { jobId: job.id, context, leaseUntil: leaseUntil.toISOString() },
        "SchedulerService: lease lost before settle (handler outran the lease) — another worker owns the slot",
      );
    }
  }

  /**
   * Sleep `ms`, resolving early on `wake()` or `stop()` (abort). Registers the
   * resolver so an out-of-band poke ends the sleep immediately; the timer is
   * `unref`'d so it never pins the event loop.
   */
  private interruptibleSleep(ms: number): Promise<void> {
    if (this.abortController.signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.abortController.signal.removeEventListener("abort", finish);
        this.wakeCurrentSleep = null;
        resolve();
      };
      const timer = setTimeout(finish, ms);
      timer.unref();
      this.wakeCurrentSleep = finish;
      this.abortController.signal.addEventListener("abort", finish, {
        once: true,
      });
    });
  }
}
