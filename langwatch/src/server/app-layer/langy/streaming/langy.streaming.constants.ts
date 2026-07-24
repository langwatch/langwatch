/**
 * Langy streaming + liveness configuration (ADR-044).
 *
 * Mirrors `scenario.constants.ts`: all magic values for the token buffer,
 * heartbeat, and reconcile timing extracted to named constants.
 *
 * The durability split (ADR-044 part 3): TOKENS live only in the short-lived
 * Redis stream keyed per (conversation, turn); milestones and the final answer
 * are durable events on the aggregate. Nothing here touches the event log.
 */

/** Redis keyspace for Langy streaming + liveness (ADR-006 hash tags). */
export const LANGY_STREAM = {
  /**
   * Per-turn token/signal stream. Hash-tagged on conversationId so the stream,
   * the heartbeat key, and any per-conversation pub/sub colocate on ONE cluster
   * slot (ADR-006) — a MULTI/pipeline over them never cross-slots.
   */
  streamKey: (conversationId: string, turnId: string): string =>
    `langy:stream:{${conversationId}}:${turnId}`,
  /** Per-turn liveness key. Same hash tag as the stream. */
  heartbeatKey: (conversationId: string, turnId: string): string =>
    `langy:hb:{${conversationId}}:${turnId}`,
} as const;

export const LANGY_STREAMING = {
  /**
   * Flush a `delta` entry to the stream once this many buffered tokens (a
   * cheap word-count proxy — we don't tokenize here) accumulate. This is the
   * SIZE arm of the hybrid flush: batching keeps XADD volume bounded on a
   * fast token stream. The TIME arm (`FLUSH_AFTER_MS`) guarantees a slow
   * stream still renders — a turn must never sit invisible waiting for a
   * batch to fill.
   */
  CHUNK_TOKENS: 64,
  /**
   * The TIME arm of the hybrid flush: pending tokens are flushed at most this
   * long after the first one buffered, even if the batch has not filled.
   * ~5 XADDs/second per turn worst case — bounded, and fast enough to read as
   * live typing. The very FIRST delta of a turn skips even this and flushes
   * immediately (time-to-first-token).
   */
  FLUSH_AFTER_MS: 200,
  /**
   * MAXLEN ~ trim bound on the stream. A turn's tail is only interesting for
   * refresh-resume; older entries past this are dropped. `~` = approximate
   * trim (cheaper for ClickHouse-free Redis MergeTree-style trimming).
   */
  STREAM_MAXLEN: 2000,
  /** TTL (seconds) refreshed on every append; the buffer self-cleans. */
  STREAM_TTL_SECONDS: 180, // 3 min (ADR-044: 2–5 min)
  /** Max ms an `XREAD BLOCK` waits before returning to re-check terminal state. */
  FOLLOW_BLOCK_MS: 15_000,
} as const;

export const LANGY_LIVENESS = {
  /** How often the worker refreshes the heartbeat key while a turn runs. */
  HEARTBEAT_INTERVAL_MS: 5_000,
  /**
   * The heartbeat key TTL = 2× the interval, so a single missed refresh does
   * not immediately expire it but a dead worker's key lapses quickly.
   */
  heartbeatTtlSeconds: (): number =>
    Math.ceil((2 * LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS) / 1000),
  /**
   * A turn with no heartbeat for at least this long is treated as stalled by
   * the liveness subscriber. Comfortably larger than the heartbeat TTL so a
   * healthy-but-briefly-paused turn is not falsely re-driven.
   */
  HEARTBEAT_GRACE_MS: 30_000,
} as const;

export const LANGY_WORKER = {
  /**
   * How many manager `/chat` calls one control-plane worker makes concurrently.
   * This is NOT the hard capacity gate — that stays the manager's
   * `ErrMaxWorkers` → "at-capacity". This only bounds in-flight bridging work
   * per control-plane worker (ADR-044 part 1).
   */
  CONCURRENCY: 8,
} as const;
