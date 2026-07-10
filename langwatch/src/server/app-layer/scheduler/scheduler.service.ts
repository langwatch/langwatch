import { randomUUID } from "crypto";
import type { Cluster, Redis } from "ioredis";
import type { ProcessRole } from "../config";
import type { Logger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { computeNextRunAt } from "./nextRunAt";
import type { SchedulerRegistry } from "./scheduler.registry";
import type {
  ScheduledJobRecord,
  ScheduledJobRepository,
} from "./scheduler.types";

/**
 * Best-effort cross-pod wake (ADR-042, user decision 2026-07-10). Postgres is
 * the sole correctness/locking layer; Redis pub/sub is a pure optimization so a
 * job created on one pod fires on every pod's loop *now* instead of within one
 * poll backstop. Fire-and-forget: a dropped publish or a down Redis costs only
 * latency (the poll still fires the job), never correctness.
 */
const WAKE_CHANNEL = "scheduler:wake";

/**
 * Safety-net backstop for the intelligent sleep: even when the next job is far
 * away, the loop re-polls at least this often so a job created on another pod
 * (which this loop's in-process `wake()` can't reach) is still picked up within
 * one backstop. ADR-042 §4: "60 s granularity is ample for calendar reports."
 */
const DEFAULT_MAX_SLEEP_MS = 60_000;

/** Max due rows claimed per cycle — bounds one worker's per-cycle work. */
const DUE_SCAN_LIMIT = 100;

/**
 * Max time `stop()` waits for the loop to unwind before proceeding anyway,
 * mirroring the outbox heartbeat's shutdown budget.
 */
const SHUTDOWN_MAX_WAIT_MS = 10_000;

/** Backoff after an unexpected cycle error so a Postgres blip can't hot-spin. */
const LOOP_ERROR_BACKOFF_MS = 1_000;

export interface SchedulerServiceDeps {
  repo: ScheduledJobRepository;
  registry: SchedulerRegistry;
  processRole: ProcessRole | undefined;
  logger: Logger;
  /** Intelligent-sleep backstop (default 60s). */
  maxSleepMs?: number;
  /**
   * Optional Redis for the best-effort cross-pod wake. When present, the loop
   * subscribes to `scheduler:wake` and re-scans immediately on any published
   * signal; producers call `SchedulerService.publishWake(redis)` on job
   * create/edit. Omit it and the scheduler is 100% Postgres — correctness is
   * identical, only cross-pod reaction latency changes (poll backstop).
   */
  redis?: Redis | Cluster | null;
}

/**
 * ADR-042 §4 — the in-process calendar scheduler loop. POSTGRES-ONLY: no
 * Redis, no cron infrastructure. A long-lived, worker-only loop that sleeps
 * until the soonest due job (intelligent sleep, backstopped by `maxSleepMs`),
 * scans due rows, atomically CLAIMS each (conditional `nextRunAt` update),
 * and fires it into a registered handler.
 *
 * Correctness + scale rest on ONE Postgres mechanism: the per-slot CONDITIONAL
 * claim (`repo.claim`). Because that claim guarantees a slot is delivered
 * exactly once no matter how many workers observe it, there is NO leader-lock
 * and NO single authoritative pod — EVERY worker runs this loop, scans, and
 * races the claim, so firing load is shared across the fleet while each slot
 * still fires exactly once. Durability is the durable `ScheduledJob` row (a
 * crash between scan and claim just leaves the row for the next poll).
 *
 * Worker-only: `start()` no-ops on any other `processRole`, so it is safe to
 * wire into shared bootstrap without role gating (mirrors
 * `OutboxHeartbeatScheduler`).
 *
 * Cross-pod early-wake is BEST-EFFORT via Redis pub/sub (optional `redis` dep):
 * a producer calls `SchedulerService.publishWake(redis)` after creating/editing
 * a job, every pod's loop subscribes to `scheduler:wake` and re-scans on the
 * signal. This is a pure latency optimization layered on the Postgres core — a
 * dropped signal or absent Redis just means the job waits for the poll backstop
 * (`maxSleepMs`), never a correctness change. Without `redis`, the scheduler is
 * 100% Postgres and `wake()` only interrupts THIS process's sleep.
 */
export class SchedulerService {
  private readonly repo: ScheduledJobRepository;
  private readonly registry: SchedulerRegistry;
  private readonly processRole: ProcessRole | undefined;
  private readonly logger: Logger;
  private readonly maxSleepMs: number;
  private readonly redis: Redis | Cluster | null;
  private readonly workerId = randomUUID();

  /** Reset on every `start()` so a stop/start cycle gets a fresh signal. */
  private abortController = new AbortController();
  private loopPromise: Promise<void> | null = null;
  private started = false;
  /** Resolver for the current interruptible sleep; `wake()` pokes it. */
  private wakeCurrentSleep: (() => void) | null = null;
  /** Dedicated subscriber connection for the cross-pod wake (null = poll-only). */
  private subscriber: Redis | Cluster | null = null;

  constructor(deps: SchedulerServiceDeps) {
    this.repo = deps.repo;
    this.registry = deps.registry;
    this.processRole = deps.processRole;
    this.logger = deps.logger;
    this.maxSleepMs = deps.maxSleepMs ?? DEFAULT_MAX_SLEEP_MS;
    this.redis = deps.redis ?? null;
  }

  /**
   * Best-effort cross-pod wake producer: signal every pod's scheduler loop to
   * re-scan now. Call after creating/editing a `ScheduledJob` (e.g. a report
   * upsert). Fire-and-forget — a publish failure is swallowed because the poll
   * backstop still fires the job.
   */
  static publishWake(redis: Redis | Cluster | null | undefined): void {
    if (!redis) return;
    void redis.publish(WAKE_CHANNEL, "1").catch(() => {
      // swallow — the poll backstop covers a missed wake (best-effort)
    });
  }

  /**
   * Producer wake: interrupt the current sleep so the loop re-scans NOW. In
   * this Postgres-only phase it only reaches a loop in the SAME process (the
   * dev single-process / undefined-role case); cross-process producers rely on
   * the poll backstop until a Postgres LISTEN/NOTIFY wake lands. Safe to call
   * whether or not the loop is currently sleeping.
   */
  wake(): void {
    this.wakeCurrentSleep?.();
  }

  /** Start the loop. No-op outside the worker role; idempotent. */
  start(): void {
    if (this.processRole !== "worker") {
      this.logger.debug(
        { processRole: this.processRole },
        "SchedulerService.start: non-worker role, skipping",
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
   * Best-effort cross-pod wake consumer. A dedicated subscriber connection
   * (subscriber mode blocks a connection, so it must be its own) pokes the
   * in-process sleep whenever any pod publishes. All failures are swallowed —
   * the poll backstop is the correctness floor, so Redis can be absent or flaky
   * without affecting exactly-once firing.
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
      } catch {
        // best-effort teardown
      }
    }

    if (this.loopPromise) {
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
        captureException(toError(error), {
          extra: { phase: "scheduler-cycle" },
        });
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
    //    simply share the firing load (ADR-042 §4).
    await this.fireDueJobs();
  }

  /** Clamp (earliest − now) into [0, maxSleepMs]; full backstop when idle. */
  private sleepMsUntil(earliest: Date | null): number {
    if (!earliest) return this.maxSleepMs;
    const untilDueMs = earliest.getTime() - Date.now();
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

  private async fireJob({
    job,
    now,
  }: {
    job: ScheduledJobRecord;
    now: Date;
  }): Promise<void> {
    // The calendar instant coming due — the value we condition the claim on.
    const slot = job.nextRunAt;

    // Advance strictly after `now`, in the job's own zone (DST-correct). A
    // poison cron/tz can't wedge the loop: deactivate the row and move on.
    let nextRunAt: Date;
    try {
      nextRunAt = computeNextRunAt({
        cron: job.cron,
        timezone: job.timezone,
        after: now,
      });
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
      captureException(toError(error), {
        extra: { phase: "scheduler-cron", jobId: job.id },
      });
      await this.repo.deactivateForTarget({
        projectId: job.projectId,
        targetType: job.targetType,
        targetId: job.targetId,
      });
      return;
    }

    // ATOMIC CLAIM. Only one worker's conditional UPDATE wins; every other
    // worker sees a lost claim and skips. This is the exactly-once guarantee.
    const won = await this.repo.claim({
      id: job.id,
      projectId: job.projectId,
      expectedNextRunAt: slot,
      nextRunAt,
      lastSlot: slot,
    });
    if (!won) {
      this.logger.debug(
        { jobId: job.id, slot: slot.toISOString() },
        "SchedulerService: slot already claimed by another worker, skipping",
      );
      return;
    }

    // We own the slot. Look up the handler; an unknown targetType is
    // log-and-skip — Phase 1 registers no consumers, so the loop must not
    // crash on an orphan row (a report handler arrives in a later phase).
    const handler = this.registry.get(job.targetType);
    if (!handler) {
      this.logger.warn(
        { jobId: job.id, targetType: job.targetType },
        "SchedulerService: no handler registered for targetType, skipping",
      );
      return;
    }

    // Run the handler. Wrap errors so one bad fire can neither kill the loop
    // nor block sibling due jobs (ADR-042 §8 riskiest-parts).
    try {
      await handler({
        projectId: job.projectId,
        targetType: job.targetType,
        targetId: job.targetId,
        slot,
      });
    } catch (error) {
      this.logger.error(
        {
          jobId: job.id,
          targetType: job.targetType,
          targetId: job.targetId,
          error: error instanceof Error ? error.message : String(error),
        },
        "SchedulerService: handler threw",
      );
      captureException(toError(error), {
        extra: { phase: "scheduler-handler", jobId: job.id },
      });
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
