import { createLogger } from "@langwatch/observability";
import { createHash } from "crypto";
import type { Cluster } from "ioredis";
import type IORedis from "ioredis";

const logger = createLogger("langwatch:shared-trace-cache");

const SHARED_TRACE_KEY_PREFIX = "shared_trace:";

/**
 * How long an assembled share payload may be reused.
 *
 * Short on purpose. A shared trace is already a snapshot — the read-only page
 * renders from one payload and has no live updates — so a viewer seeing
 * up-to-a-minute-old data changes nothing they would have noticed, while the
 * cache removes the repeated ClickHouse fan-out behind an unauthenticated URL.
 */
export const SHARED_TRACE_CACHE_TTL_SECONDS = 60;

export interface SharedTracePayloadCache {
  get(key: string): Promise<unknown | null>;
  set(key: string, payload: unknown): Promise<void>;
}

/** No Redis (tests, SKIP_REDIS, dev without Redis): assemble every time. */
class NullSharedTracePayloadCache implements SharedTracePayloadCache {
  async get(): Promise<unknown | null> {
    return null;
  }
  async set(): Promise<void> {
    /* no-op */
  }
}

/**
 * Best-effort cache of the assembled share payload.
 *
 * NEVER a substitute for authorization: the caller resolves the token first
 * and only then consults this, so a revoked, expired or exhausted link stops
 * serving immediately regardless of what is cached.
 *
 * The key carries a fingerprint of the viewer's protections, because the same
 * trace redacts differently per viewer — an anonymous viewer and a signed-in
 * member with `cost:view` must never share an entry.
 */
export class RedisSharedTracePayloadCache implements SharedTracePayloadCache {
  constructor(private readonly redis: IORedis | Cluster) {}

  async get(key: string): Promise<unknown | null> {
    try {
      const raw = await this.redis.get(`${SHARED_TRACE_KEY_PREFIX}${key}`);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      // A cache miss is always safe; never fail a share read on Redis.
      logger.warn({ error }, "shared trace cache read failed; assembling");
      return null;
    }
  }

  async set(key: string, payload: unknown): Promise<void> {
    try {
      await this.redis.set(
        `${SHARED_TRACE_KEY_PREFIX}${key}`,
        JSON.stringify(payload),
        "EX",
        SHARED_TRACE_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      logger.warn({ error }, "shared trace cache write failed");
    }
  }
}

export function createSharedTracePayloadCache(
  redis: IORedis | Cluster | null,
): SharedTracePayloadCache {
  if (!redis) return new NullSharedTracePayloadCache();
  return new RedisSharedTracePayloadCache(redis);
}

/**
 * Cache key for one token as seen by one viewer. Everything that changes what
 * the payload contains has to be in here, or a viewer could be served another
 * viewer's redaction. `protections` is the whole per-viewer redaction input,
 * so it is hashed wholesale rather than cherry-picked — a new protection field
 * is covered without anyone remembering to add it.
 */
export function buildSharedTraceCacheKey({
  token,
  protections,
}: {
  token: string;
  protections: unknown;
}): string {
  const fingerprint = createHash("sha256")
    .update(stableStringify(protections))
    .digest("hex")
    .slice(0, 32);
  return `${token}:${fingerprint}`;
}

/** Key-order-independent JSON, so an equivalent object always hashes alike. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}
