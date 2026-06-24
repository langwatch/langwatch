import { randomUUID } from "crypto";
import type { Cluster, Redis } from "ioredis";
import type { ProcessRole } from "~/server/app-layer/config";
import type { Logger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { OutboxEnqueueRequest } from "../outboxReactor.types";
import type { OutboxHeartbeatRegistry } from "./heartbeat.registry";
import type {
  HeartbeatDecideContext,
  HeartbeatDefinition,
} from "./heartbeat.types";

/**
 * Minimum tick interval. Sub-second cadences are clamped here so a
 * misconfigured 0/negative interval cannot spin the loop.
 */
const MIN_INTERVAL_MS = 1_000;

/**
 * Minimum Redis-lock TTL. The lock TTL is `max(intervalMs * 2, 30s)`
 * so even on a fast cadence the lock has room for heavy work without
 * being lost.
 */
const MIN_LOCK_TTL_MS = 30_000;

const LOCK_KEY_PREFIX = "hb:lock:";

/**
 * Lua CAS-DEL: release the lock ONLY when the value still matches the
 * worker's unique token. Without this, a worker whose tick overran the
 * TTL would release a lock another worker had just acquired.
 */
const RELEASE_LOCK_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Dispatch shape the scheduler hands `decide` results to. Same signature
 * the heartbeat consumer ultimately wants — the scheduler doesn't know
 * how `OutboxEnqueueRequest`s become rows on the queue; it just hands
 * them to the framework's shared dispatch helper.
 */
export type DispatchOutboxEnqueues = (params: {
  requests: OutboxEnqueueRequest[];
  sourceName: string;
}) => Promise<void>;

export interface OutboxHeartbeatSchedulerDeps {
  registry: OutboxHeartbeatRegistry;
  /**
   * Redis client used for the leader-election lock. Required even
   * though `start()` no-ops on web — the scheduler is constructed
   * worker-only, so a missing Redis here is a wiring bug.
   *
   * Both standalone `Redis` and `Cluster` are accepted; the
   * commands the scheduler issues (`SET ... NX EX`, `EVAL`) are
   * supported on both.
   */
  redis: Redis | Cluster;
  dispatchOutboxEnqueues: DispatchOutboxEnqueues;
  processRole: ProcessRole | undefined;
  logger: Logger;
}

/**
 * Schedules registered heartbeats. Worker-only at runtime: on any other
 * `processRole`, `start()` is a no-op (timers never spin up) so this
 * class is safe to wire into shared bootstrap code without role gating.
 *
 * On each tick:
 *   1. Acquire a per-heartbeat Redis lock with `SET NX EX`. The value
 *      is a unique token so only the holder can release it.
 *   2. If acquired, call `decide({ now, abortSignal })`. Route the
 *      results through `dispatchOutboxEnqueues` (the same helper
 *      `adaptOutboxReactor` uses, so heartbeat-sourced enqueues hit
 *      the same downstream code path as event-sourced enqueues).
 *   3. Release the lock via a Lua CAS-DEL so a lock another worker has
 *      taken (after our TTL elapsed) is not stolen back.
 *   4. If not acquired, skip the tick — another worker has the lead.
 *
 * Errors in `decide` / dispatch are caught + logged + captured; the
 * lock is still released; the next tick still fires.
 */
export class OutboxHeartbeatScheduler {
  private readonly registry: OutboxHeartbeatRegistry;
  private readonly redis: Redis | Cluster;
  private readonly dispatch: DispatchOutboxEnqueues;
  private readonly processRole: ProcessRole | undefined;
  private readonly logger: Logger;
  private readonly workerId = randomUUID();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly abortController = new AbortController();
  private started = false;

  constructor(deps: OutboxHeartbeatSchedulerDeps) {
    this.registry = deps.registry;
    this.redis = deps.redis;
    this.dispatch = deps.dispatchOutboxEnqueues;
    this.processRole = deps.processRole;
    this.logger = deps.logger;
  }

  /**
   * Spin up one timer per registered heartbeat. No-op outside the
   * worker role.
   *
   * Idempotent: a second `start()` after a successful first call is a
   * no-op.
   */
  start(): void {
    if (this.processRole !== "worker") {
      this.logger.debug(
        { processRole: this.processRole },
        "OutboxHeartbeatScheduler.start: non-worker role, skipping",
      );
      return;
    }
    if (this.started) return;
    this.started = true;

    const heartbeats = this.registry.getAll();
    for (const heartbeat of heartbeats) {
      this.scheduleHeartbeat(heartbeat);
    }
    this.logger.info(
      { count: heartbeats.length, workerId: this.workerId },
      "OutboxHeartbeatScheduler started",
    );
  }

  /**
   * Tear down all timers. Aborts any in-flight `decide` calls via the
   * shared abort controller.
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.abortController.abort();
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.logger.info(
      { workerId: this.workerId },
      "OutboxHeartbeatScheduler stopped",
    );
  }

  private scheduleHeartbeat(heartbeat: HeartbeatDefinition): void {
    const intervalMs = Math.max(MIN_INTERVAL_MS, heartbeat.intervalMs);
    const lockTtlMs = Math.max(MIN_LOCK_TTL_MS, intervalMs * 2);
    const timer = setInterval(() => {
      void this.runTick({ heartbeat, lockTtlMs }).catch((error) => {
        // Belt-and-braces: runTick already catches `decide`/dispatch
        // errors internally, so reaching here means the lock-acquire
        // path itself threw (Redis blip). Log + capture; the next tick
        // still fires.
        this.logger.error(
          {
            heartbeat: heartbeat.name,
            error: error instanceof Error ? error.message : String(error),
          },
          "OutboxHeartbeatScheduler tick crashed before decide",
        );
        captureException(toError(error), {
          extra: { heartbeat: heartbeat.name, phase: "tick-outer" },
        });
      });
    }, intervalMs);
    // `unref()` so the timer never holds the process open on shutdown.
    timer.unref();
    this.timers.set(heartbeat.name, timer);
  }

  private async runTick({
    heartbeat,
    lockTtlMs,
  }: {
    heartbeat: HeartbeatDefinition;
    lockTtlMs: number;
  }): Promise<void> {
    const lockKey = `${LOCK_KEY_PREFIX}${heartbeat.name}`;
    const acquired = await this.acquireLock({ lockKey, ttlMs: lockTtlMs });
    if (!acquired) {
      this.logger.debug(
        { heartbeat: heartbeat.name, workerId: this.workerId },
        "OutboxHeartbeatScheduler: lock held by another worker, skipping tick",
      );
      return;
    }

    try {
      const context: HeartbeatDecideContext = {
        now: new Date(),
        abortSignal: this.abortController.signal,
      };
      const requests = await heartbeat.decide(context);
      await this.dispatch({
        requests,
        sourceName: heartbeat.name,
      });
    } catch (error) {
      this.logger.error(
        {
          heartbeat: heartbeat.name,
          error: error instanceof Error ? error.message : String(error),
        },
        "OutboxHeartbeatScheduler: decide/dispatch failed",
      );
      captureException(toError(error), {
        extra: { heartbeat: heartbeat.name, phase: "decide" },
      });
    } finally {
      await this.releaseLock({ lockKey });
    }
  }

  private async acquireLock({
    lockKey,
    ttlMs,
  }: {
    lockKey: string;
    ttlMs: number;
  }): Promise<boolean> {
    // `PX` (millisecond TTL) keeps the precision the caller asked for;
    // `NX` makes this the leader-election primitive.
    const result = await this.redis.set(
      lockKey,
      this.workerId,
      "PX",
      ttlMs,
      "NX",
    );
    return result !== null;
  }

  private async releaseLock({ lockKey }: { lockKey: string }): Promise<void> {
    try {
      await this.redis.eval(RELEASE_LOCK_LUA, 1, lockKey, this.workerId);
    } catch (error) {
      // A failed release is non-fatal — the TTL will reap the lock
      // anyway, just a little later. Logging at warn so operators see
      // sustained release failures (which would suggest a Redis perms
      // problem worth investigating) without paging.
      this.logger.warn(
        {
          lockKey,
          error: error instanceof Error ? error.message : String(error),
        },
        "OutboxHeartbeatScheduler: lock release failed (TTL will reap)",
      );
    }
  }
}
