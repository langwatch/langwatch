import { randomUUID } from "crypto";
import type { Cluster, Redis } from "ioredis";
import { type ProcessRole, roleRunsWorkers } from "../config";
import type { Logger } from "@langwatch/observability";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { computeCatchUp, computeNextRunAt } from "./nextRunAt";
import type { SchedulerRegistry } from "./scheduler.registry";
import type {
  ScheduledJobRecord,
  ScheduledJobRepository,
} from "./scheduler.types";

/**
 * Best-effort cross-pod wake (ADR-044, user decision 2026-07-10). Postgres is
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
 * one backstop. ADR-044 §4: "60 s granularity is ample for calendar reports."
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

/**
 * Lease window a winning claim buys before it has to settle. Chosen comfortably
 * larger than any plausible handler runtime (a report render + email/Slack send
 * is seconds to low-minutes even under provider slowness / a ClickHouse stall),
 * so the leased row stays hidden from `findDue` (`nextRunAt <= now`) for the
 * whole handler run — which both stops a second worker double-claiming the slot
 * AND is the retry backoff if this worker crashes mid-fire (the lease simply
 * expires and the slot re-fires). Short enough that a crashed lease is retried
 * within ~10 min rather than parked for a cron period.
 */
const LEASE_MS = 10 * 60_000;

/**
 * How many times a single slot is attempted before it is abandoned to the next
 * cron instant. Small so a persistently-broken target (dead Slack webhook,
 * deleted report) can't retry forever, but enough headroom to ride out a
 * transient provider/ClickHouse blip. The Nth failure abandons; the first N−1
 * retry.
 */
const MAX_ATTEMPTS = 5;

/** Base + cap for the bounded exponential retry backoff (see `backoffMs`). */
const BACKOFF_BASE_MS = 60_000; // 1 min — matches the ADR-044 60s calendar granularity
const BACKOFF_CAP_MS = 30 * 60_000; // 30 min — an upper bound if MAX_ATTEMPTS grows

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
 * ADR-044 §4 — the in-process calendar scheduler loop. POSTGRES-ONLY: no
 * Redis, no cron infrastructure. A long-lived, worker-only loop that sleeps
 * until the soonest due job (intelligent sleep, backstopped by `maxSleepMs`),
 * scans due rows, atomically LEASES each (conditional `nextRunAt` update), runs
 * its registered handler, and only THEN advances the calendar.
 *
 * Correctness + scale rest on ONE Postgres mechanism: the per-slot CONDITIONAL
 * lease (`repo.claim`). Because that lease guarantees exactly one worker owns a
 * slot no matter how many observe it, there is NO leader-lock and NO single
 * authoritative pod — EVERY worker runs this loop, scans, and races the lease,
 * so firing load is shared across the fleet while each slot fires from exactly
 * one worker. A lease pushes `nextRunAt` a near-future window ahead WITHOUT
 * marking the slot delivered (`lastSlot` untouched); the calendar advances only
 * via `repo.settleClaim` after the handler returns. So a handler failure retries
 * the SAME slot (bounded backoff, up to `MAX_ATTEMPTS`, then abandon-with-alert)
 * and a crash mid-fire re-fires the slot when the lease expires — a failed slot
 * is never silently lost. Durability is the durable `ScheduledJob` row.
 *
 * Worker-stack-only: `start()` no-ops unless the role runs the worker stack
 * (`roleRunsWorkers`: "worker" AND the dev single-process "all" role), so it
 * is safe to wire into shared bootstrap without role gating (the same role
 * boundary used by process-manager wake workers).
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

  /** Start the loop. No-op for roles without the worker stack; idempotent. */
  start(): void {
    if (!roleRunsWorkers(this.processRole)) {
      this.logger.debug(
        { processRole: this.processRole },
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
    //    simply share the firing load (ADR-044 §4).
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
    // The lease is still conditioned on the row's CURRENT wake instant — that
    // is what `findDue` read and what a racing worker would also condition on.
    const claimAt = job.nextRunAt;

    // Derive the slot to fire and the next calendar marker (both DST-correct in
    // the job's own zone). Computed up front so a poison cron/tz deactivates the
    // row *before* leasing (a bad row can't wedge the loop).
    //
    //  - RETRY / crash-refire (`currentSlot` pinned): re-fire that EXACT slot —
    //    catch-up must not move a slot already in flight. Advance honestly to
    //    the next instant after it, only fast-forwarding past `now` if a long
    //    retry sequence outran a whole cron period (so a completed retry never
    //    re-arms in the past).
    //  - FRESH fire: apply the ADR-044 `runLatest` catch-up. On time this is a
    //    no-op (fire `nextRunAt`, advance to the next instant); after an outage
    //    it fires ONE catch-up for the newest missed slot and fast-forwards to
    //    the first future instant, instead of replaying every missed slot.
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

    // ATOMIC LEASE. Only one worker's conditional UPDATE wins; every other
    // worker sees a lost claim and skips. The winner pushes `nextRunAt` a lease
    // window into the future WITHOUT advancing the calendar or `lastSlot`, so
    // the slot is hidden from `findDue` for the handler run but is NOT yet
    // marked delivered — a failure retries it, a crash re-fires it on lease
    // expiry. This is the exactly-once guarantee for concurrent workers.
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

    // Run the handler. On SUCCESS, advance the calendar and stamp `lastSlot =
    // slot` (the "delivered" marker), clearing retry state. On FAILURE, hand to
    // the retry policy — the slot is retried, never silently lost.
    //
    // Report delivery is therefore AT-LEAST-ONCE: a crash AFTER the handler's
    // provider send but BEFORE this settle re-leases the slot on lease expiry
    // and re-fires it, so a duplicate report can go out. That is an accepted
    // ADR-044 tradeoff — vastly better than the previous silent zero-delivery —
    // and a distributed dedup ledger is deliberately OUT OF SCOPE here.
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
   * Retry policy for a thrown handler (ADR-044 "fire into a retrying path").
   * Under the cap the SAME slot is retried after a bounded backoff (`lastSlot`
   * left untouched, so it is not counted delivered). At the cap the slot is
   * abandoned to the next cron instant so the schedule can't wedge — loud +
   * captured so an abandoned slot is OBSERVABLE, never a silent zero-delivery.
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
      const retryAt = new Date(Date.now() + this.backoffMs(attempts));
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
      captureException(toError(error), {
        extra: {
          phase: "scheduler-handler",
          jobId: job.id,
          attempt: attempts + 1,
        },
      });
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
    // is kept for the operator. logger.error + captureException make it visible.
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
    captureException(toError(error), {
      extra: {
        phase: "scheduler-abandon",
        jobId: job.id,
        attempts: MAX_ATTEMPTS,
      },
    });
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
   * Settle the lease this worker holds via the repo's conditional writer. A
   * `false` return means the lease expired and another worker re-claimed the
   * slot (handler outran LEASE_MS) — log it, since that worker will re-fire and
   * our settle is void; correctness holds (at-least-once) but it is worth
   * seeing.
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
