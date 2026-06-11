import { connection } from "~/server/redis";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:outbox:emailHourlyCap");

/**
 * ADR-031: per-trigger hourly hard cap on dispatched trigger emails.
 *
 * A fixed-hour Redis counter — one INCR per email *dispatch* (a digest of
 * N traces counts as 1, not per trace and not per recipient). The fixed
 * window's worst case (up to 2× burst across an hour boundary) is irrelevant
 * at this granularity; it buys a single Redis round-trip per dispatch.
 *
 *   key:    trigger-email-cap:{projectId}:{triggerId}:{floor(now / 1h)}
 *   INCR + EXPIRE 2h NX (set TTL only when absent, so it never slides but a
 *   transient first-hit failure can't leak an immortal key)
 *   allowed = count <= cap
 *
 * Mirrors `src/server/rateLimit.ts`: Redis when available, an in-memory Map
 * fallback for unit tests / SKIP_REDIS / dev-without-Redis.
 */

const HOUR_MS = 3600_000;
const EXPIRE_SECONDS = 7200;

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

/**
 * Opportunistic GC for the in-memory fallback, same shape as
 * `rateLimit.ts`: sweep expired entries once the map crosses a threshold so
 * a long-lived dev process with many (projectId, triggerId, hourBucket)
 * keys doesn't leak unbounded. Production uses Redis and never reaches here.
 */
const MEMORY_GC_THRESHOLD = 1000;
function sweepExpiredMemoryEntries(now: number): void {
  if (memoryStore.size < MEMORY_GC_THRESHOLD) return;
  for (const [k, v] of memoryStore) {
    if (v.expiresAt <= now) memoryStore.delete(k);
  }
}

export async function consumeEmailCapSlot({
  projectId,
  triggerId,
  now,
  cap,
}: {
  projectId: string;
  triggerId: string;
  now: Date;
  cap: number;
}): Promise<{ allowed: boolean; count: number }> {
  const hourBucket = Math.floor(now.getTime() / HOUR_MS);
  const key = `trigger-email-cap:${projectId}:${triggerId}:${hourBucket}`;

  if (connection) {
    try {
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
      // the cap keeps working approximately while Redis recovers.
      logger.warn(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis error consuming email cap slot — falling back to in-memory counter",
      );
    }
  }

  const nowMs = now.getTime();
  sweepExpiredMemoryEntries(nowMs);

  const existing = memoryStore.get(key);
  if (!existing || existing.expiresAt <= nowMs) {
    memoryStore.set(key, { count: 1, expiresAt: nowMs + EXPIRE_SECONDS * 1000 });
    return { allowed: 1 <= cap, count: 1 };
  }
  existing.count += 1;
  return { allowed: existing.count <= cap, count: existing.count };
}

/** Test-only: clear in-memory state. No-op for Redis. */
export function _resetMemoryEmailCapStore(): void {
  memoryStore.clear();
}
