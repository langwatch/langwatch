import { connection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:outbox:emailHourlyCap");

/**
 * ADR-031: per-trigger hourly hard cap on dispatched trigger emails.
 *
 * A fixed-hour Redis counter — at most one INCR per logical email *dispatch*
 * (a digest of N traces counts as 1, not per trace and not per recipient, and
 * — critically — not per outbox *attempt*). A retryable provider failure makes
 * the outbox replay the SAME dispatch; counting per attempt would let a
 * flapping provider burn extra cap slots and over-throttle legitimate mail
 * (the retry double-count finding). The INCR is therefore gated behind a
 * per-dispatch idempotency claim: a `cap-claimed:{dedupKey}` SET-NX. Only the
 * worker that newly wins the claim consumes a slot; a retry of the same
 * dispatch sees the claim already set and re-reads the current count without
 * incrementing.
 *
 *   claim: cap-claimed:{dedupKey}      SET ... NX EX 2h
 *          won → INCR the counter; lost (retry) → GET the counter, no INCR
 *   key:   trigger-email-cap:{projectId}:{triggerId}:{floor(now / 1h)}
 *          INCR + EXPIRE 2h NX (set TTL only when absent, so it never slides
 *          but a transient first-hit failure can't leak an immortal key)
 *   allowed = count <= cap
 *
 * The fixed window's worst case (up to 2× burst across an hour boundary) is
 * irrelevant at this granularity; it buys at most two Redis round-trips per
 * dispatch (claim + counter).
 *
 * Mirrors `src/server/rateLimit.ts`: Redis when available, an in-memory Map
 * fallback for unit tests / SKIP_REDIS / dev-without-Redis. The fallback
 * degrades the cap to per-worker counters — see the ERROR log below.
 */

const HOUR_MS = 3600_000;
const EXPIRE_SECONDS = 7200;

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

/**
 * In-memory mirror of the `cap-claimed:{dedupKey}` SET-NX gate. A dispatch's
 * dedupKey lands here on first sight (claim won → INCR); a retry of the same
 * dispatch finds it present (claim lost → no INCR). Values are the claim
 * expiry so the same opportunistic sweep that GCs counters also reaps claims.
 */
const claimStore = new Map<string, number>();

/**
 * Opportunistic GC for the in-memory fallback, same shape as
 * `rateLimit.ts`: sweep expired entries once the map crosses a threshold so
 * a long-lived dev process with many (projectId, triggerId, hourBucket)
 * keys doesn't leak unbounded. Production uses Redis and never reaches here.
 */
const MEMORY_GC_THRESHOLD = 1000;
function sweepExpiredMemoryEntries(now: number): void {
  if (memoryStore.size >= MEMORY_GC_THRESHOLD) {
    for (const [k, v] of memoryStore) {
      if (v.expiresAt <= now) memoryStore.delete(k);
    }
  }
  if (claimStore.size >= MEMORY_GC_THRESHOLD) {
    for (const [k, expiresAt] of claimStore) {
      if (expiresAt <= now) claimStore.delete(k);
    }
  }
}

export async function consumeEmailCapSlot({
  projectId,
  triggerId,
  now,
  cap,
  dedupKey,
}: {
  projectId: string;
  triggerId: string;
  now: Date;
  cap: number;
  /**
   * Stable per-dispatch identity (ADR-031): the audit dedup key / cadence
   * digest id for THIS logical dispatch. Used as the SET-NX claim so an outbox
   * retry of the same dispatch does not re-INCR and burn a second cap slot. The
   * caller already has this — see the dispatcher's `auditDedupKey`.
   */
  dedupKey: string;
}): Promise<{ allowed: boolean; count: number }> {
  const hourBucket = Math.floor(now.getTime() / HOUR_MS);
  const key = `trigger-email-cap:${projectId}:${triggerId}:${hourBucket}`;
  const claimKey = `cap-claimed:${dedupKey}`;

  if (connection) {
    try {
      // Claim this dispatch first. SET NX wins only on first sight; a retry of
      // the same dispatch loses the claim and must NOT consume another slot.
      const claimed = await connection.set(
        claimKey,
        "1",
        "EX",
        EXPIRE_SECONDS,
        "NX",
      );
      if (!claimed) {
        // Retry of an already-counted dispatch: read the current count without
        // incrementing. A missing counter (TTL rolled the hour) reads as 0,
        // which stays `allowed` — the original consumption already happened.
        const raw = await connection.get(key);
        const count = raw ? Number(raw) : 0;
        return { allowed: count <= cap, count };
      }
      const count = await connection.incr(key);
      // Always set TTL with NX semantics (only when no TTL exists yet) so a
      // transient first-hit EXPIRE failure can't leave an immortal key — every
      // subsequent hit re-attempts it without sliding an existing window.
      await connection.expire(key, EXPIRE_SECONDS, "NX");
      return { allowed: count <= cap, count };
    } catch (error) {
      // A Redis blip must not let the cap silently fail open. The dispatcher
      // catches throws as retryable and would retry the spam; instead, fall
      // back to the in-memory counter (same path as connection-undefined) so
      // the cap keeps working approximately while Redis recovers. Log at ERROR
      // (not warn): the cap is now degraded to per-worker counters, so the true
      // cross-worker rate can exceed `cap` until Redis recovers — operators
      // need to see this, not have it buried as a warning.
      logger.error(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis error consuming email cap slot — cap DEGRADED to per-worker " +
          "in-memory counters until Redis recovers; cross-worker rate may " +
          "exceed the configured cap",
      );
    }
  }

  const nowMs = now.getTime();
  sweepExpiredMemoryEntries(nowMs);

  // In-memory claim gate, mirroring the Redis SET-NX: a retry of the same
  // dispatch that already consumed a slot re-reads the count without INCR.
  const existingClaim = claimStore.get(claimKey);
  if (existingClaim !== undefined && existingClaim > nowMs) {
    const existing = memoryStore.get(key);
    if (!existing || existing.expiresAt <= nowMs) {
      return { allowed: 0 <= cap, count: 0 };
    }
    return { allowed: existing.count <= cap, count: existing.count };
  }
  claimStore.set(claimKey, nowMs + EXPIRE_SECONDS * 1000);

  const existing = memoryStore.get(key);
  if (!existing || existing.expiresAt <= nowMs) {
    memoryStore.set(key, {
      count: 1,
      expiresAt: nowMs + EXPIRE_SECONDS * 1000,
    });
    return { allowed: 1 <= cap, count: 1 };
  }
  existing.count += 1;
  return { allowed: existing.count <= cap, count: existing.count };
}

/** Test-only: clear in-memory state. No-op for Redis. */
export function _resetMemoryEmailCapStore(): void {
  memoryStore.clear();
  claimStore.clear();
}
