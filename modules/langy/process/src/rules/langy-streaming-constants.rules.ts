/** Langy streaming + liveness configuration (ADR-044). Mirrors scenario.constants.ts.
 * Durability split: tokens in Redis per (conversation, turn); milestones and answers
 * are durable aggregate events. Nothing here touches the event log. */

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
   * Flush a `delta` entry once this many buffered tokens (a cheap word-count
   * proxy) accumulate - the SIZE arm of the hybrid flush, bounding XADD
   * volume; the TIME arm (`FLUSH_AFTER_MS`) covers a slow stream.
   */
  CHUNK_TOKENS: 64,
  /**
   * The TIME arm of the hybrid flush: pending tokens flush at most this long
   * after the first one buffered. ~5 XADDs/second worst case, fast enough to
   * read as live typing. The turn's FIRST delta skips this and flushes immediately.
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
  heartbeatTtlSeconds: (): number => Math.ceil((2 * LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS) / 1000),
  /**
   * A turn with no heartbeat for at least this long is treated as stalled by
   * the liveness subscriber. Comfortably larger than the heartbeat TTL so a
   * healthy-but-briefly-paused turn is not falsely re-driven.
   */
  HEARTBEAT_GRACE_MS: 30_000,
} as const;
