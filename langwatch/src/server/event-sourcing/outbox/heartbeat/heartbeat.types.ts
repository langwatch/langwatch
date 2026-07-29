import type { OutboxEnqueueRequest } from "../outboxReactor.types";

/**
 * # Outbox heartbeat primitive (ADR-034, Phase 4)
 *
 * A periodic, framework-level scheduler that lets a consumer enqueue
 * outbox dispatch requests in cases the event-driven outbox path
 * STRUCTURALLY cannot reach. Two examples:
 *
 *   - **No-data detection**: a custom-graph alert that fires when a
 *     metric drops to zero has no "drop to zero" event — there is, by
 *     definition, no event to react to. A heartbeat periodically scans
 *     the rollup and fires when the absence-of-data condition holds.
 *
 *   - **Resolve-when-traffic-stops**: an alert that auto-resolves when
 *     the metric stays below threshold for N minutes. Same shape:
 *     "still nothing happening" cannot be observed via an event.
 *
 * Everything else — debounce, fan-out, dedup, retries, audit — is the
 * SAME machinery the event-driven outbox uses. A heartbeat's `decide`
 * returns `OutboxEnqueueRequest[]`, exactly like
 * `OutboxReactorDefinition.decide` does, and the scheduler routes those
 * through the shared `dispatchOutboxEnqueues` helper. One canonical
 * handler runs regardless of whether an event or a tick woke it up.
 *
 * **Use it for**:
 *   - Absence detection (no data, zero matches, "still quiet").
 *   - Safety-net resolves the event path can't see.
 *
 * **Do NOT use it for**:
 *   - Anything the event-driven outbox CAN react to (throttling,
 *     debouncing, fan-out). Use `.withOutbox(...)` for those — it's
 *     cheaper, lower-latency, and avoids tick-quantised reaction
 *     delays.
 *
 * Runtime constraints:
 *   - Worker-only — `start()` is a no-op outside `processRole === "worker"`
 *     so registration code can live in shared modules without
 *     role-checking.
 *   - Redis-locked leader election per heartbeat name — exactly one of
 *     the N worker replicas runs each tick.
 *   - Sub-1s `intervalMs` is clamped to 1s; lock TTL = `max(intervalMs
 *     * 2, 30s)` so heavy work has room without losing the lock.
 */
export interface HeartbeatDecideContext {
  /**
   * Wall-clock time the scheduler captured when the tick fired. Use
   * this — not `Date.now()` — so log timelines stay coherent with the
   * tick that actually triggered the work.
   */
  now: Date;
  /**
   * Aborted when the scheduler is shutting down. `decide` implementations
   * doing long-running work (e.g. scanning many projects) should check
   * `aborted` between batches so a SIGTERM exits promptly instead of
   * blocking shutdown.
   */
  abortSignal: AbortSignal;
}

/**
 * A registered heartbeat. Naming `name` collides as a process-singleton
 * — second registration throws — so consumers get noisy fail-fast
 * behaviour if they accidentally double-register.
 */
export interface HeartbeatDefinition {
  /**
   * Unique identifier across the process. Also the Redis lock key
   * suffix (`hb:lock:{name}`), so it must be stable across deploys for
   * leader election to work across rolling restarts.
   */
  name: string;
  /**
   * Tick cadence in milliseconds. Clamped to a minimum of 1_000ms by
   * the scheduler so a misconfigured 0/negative interval doesn't spin
   * the loop.
   */
  intervalMs: number;
  /**
   * Called on each tick AFTER the Redis leader lock has been acquired.
   * Returns the outbox enqueue requests the framework should dispatch.
   * Return shape mirrors `OutboxReactorDefinition.decide` so both paths
   * feed the same downstream dispatch.
   *
   * Exceptions thrown here are caught + logged by the scheduler — they
   * do NOT kill the tick loop. The lock is released either way.
   */
  decide(context: HeartbeatDecideContext): Promise<OutboxEnqueueRequest[]>;
}
