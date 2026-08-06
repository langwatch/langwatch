/**
 * Security primitives for the standalone MCP HTTP server.
 *
 * The standalone server runs on developer machines and inside clusters with no
 * database of its own, so it cannot look an API key up locally the way the
 * in-app handler does. These helpers give it the same guarantees over HTTP:
 * an origin allowlist, API key verification against the LangWatch API with a
 * short-lived cache, per-IP rate limiting of failed authentication, and a
 * session store that expires idle sessions and caps concurrency per key.
 */

import { createHash, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Bind host
// ---------------------------------------------------------------------------

/**
 * Default listen address. The MCP transport specification says a local server
 * should bind only to loopback, because binding every interface exposes it to
 * anything that can reach the machine.
 */
export const DEFAULT_BIND_HOST = "127.0.0.1";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** True when binding to this host only accepts connections from the machine itself. */
export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(stripBrackets(host.trim().toLowerCase()));
}

// ---------------------------------------------------------------------------
// Origin allowlist
// ---------------------------------------------------------------------------

/**
 * Origins accepted without configuration.
 *
 * A DNS rebinding attack reaches the server through an attacker-controlled
 * hostname that resolves to a loopback address, so the browser sends that
 * attacker hostname in the Origin header. It can never send a loopback origin
 * for a page it did not actually load from this machine, which is the case the
 * server exists to serve.
 */
const ALWAYS_ALLOWED_ORIGIN_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Reduces an origin to `scheme://host[:port]` so comparisons ignore trailing
 * slashes, paths, and case differences. Returns null for anything that is not
 * a usable origin, including the opaque `null` origin sent by sandboxed frames
 * and `file://` pages.
 */
function normalizeOrigin(origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(origin.trim());
  } catch {
    return null;
  }
  if (parsed.origin === "null") return null;
  return parsed.origin;
}

/** Parses a comma separated origin list into normalized origins. */
export function parseAllowedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const parsed = raw
    .split(",")
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => entry !== null);
  return [...new Set(parsed)];
}

/**
 * True when a browser sending this Origin should be allowed through. Loopback
 * origins always pass; everything else has to be configured explicitly. There
 * is deliberately no wildcard: an operator who needs a remote origin lists it.
 */
export function isOriginAllowed(
  origin: string,
  allowedOrigins: readonly string[]
): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const hostname = stripBrackets(new URL(normalized).hostname.toLowerCase());
  if (ALWAYS_ALLOWED_ORIGIN_HOSTS.has(hostname)) return true;

  return allowedOrigins.includes(normalized);
}

// ---------------------------------------------------------------------------
// API key hashing and comparison
// ---------------------------------------------------------------------------

/**
 * Derives an opaque identifier from an API key. Raw keys must never be used as
 * map keys or counters, because those surface in heap dumps and debug output.
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** Constant-time API key comparison over fixed-length digests. */
export function apiKeysMatch(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// Rate limiter (sliding window per IP)
// ---------------------------------------------------------------------------

export interface RateLimiter {
  /** True when this IP is over the limit. Does not increment. */
  isBlocked(ip: string): boolean;
  /** Records one request for this IP. */
  track(ip: string): void;
  /** Drops entries whose window has passed. */
  sweep(): void;
  /** Drops every entry. */
  clear(): void;
}

export function createRateLimiter({
  windowMs,
  maxRequests,
}: {
  windowMs: number;
  maxRequests: number;
}): RateLimiter {
  const entries = new Map<string, { count: number; windowStart: number }>();

  return {
    isBlocked(ip) {
      const entry = entries.get(ip);
      if (!entry || Date.now() - entry.windowStart > windowMs) return false;
      return entry.count >= maxRequests;
    },
    track(ip) {
      const now = Date.now();
      const entry = entries.get(ip);
      if (!entry || now - entry.windowStart > windowMs) {
        entries.set(ip, { count: 1, windowStart: now });
      } else {
        entry.count++;
      }
    },
    sweep() {
      const now = Date.now();
      for (const [ip, entry] of entries) {
        if (now - entry.windowStart > windowMs) entries.delete(ip);
      }
    },
    clear() {
      entries.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// API key verifier
// ---------------------------------------------------------------------------

/**
 * The lightest authenticated read the LangWatch API exposes. It accepts any
 * project API key and returns only the identity of the project behind it, so
 * it answers "is this key real" without granting or costing anything else.
 */
const VERIFY_PATH = "/api/me/project";

export interface ApiKeyVerifier {
  /** True when the LangWatch API recognises this key. */
  verify(apiKey: string): Promise<boolean>;
  /** Drops expired cache entries. */
  sweep(): void;
  /** Drops every cache entry. */
  clear(): void;
}

export function createApiKeyVerifier({
  endpoint,
  positiveTtlMs = 60_000,
  negativeTtlMs = 30_000,
  maxEntries = 10_000,
  fetchImpl = fetch,
}: {
  endpoint: string;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  maxEntries?: number;
  fetchImpl?: typeof fetch;
}): ApiKeyVerifier {
  const cache = new Map<string, { valid: boolean; expiresAt: number }>();
  const inFlight = new Map<string, Promise<boolean>>();

  function sweep(): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now >= entry.expiresAt) cache.delete(key);
    }
  }

  function remember(hashed: string, valid: boolean): void {
    if (cache.size >= maxEntries) {
      sweep();
      // Map iteration is insertion ordered, so the first key is the oldest.
      while (cache.size >= maxEntries) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }
    }
    cache.set(hashed, {
      valid,
      expiresAt: Date.now() + (valid ? positiveTtlMs : negativeTtlMs),
    });
  }

  async function askApi(apiKey: string): Promise<boolean | null> {
    let response: Response;
    try {
      response = await fetchImpl(`${endpoint}${VERIFY_PATH}`, {
        method: "GET",
        headers: { "X-Auth-Token": apiKey },
      });
    } catch {
      return null;
    }

    // Only the status matters. Releasing the body returns the socket to the
    // pool instead of holding it until garbage collection.
    await response.body?.cancel().catch(() => undefined);

    if (response.ok) return true;
    if (response.status === 401 || response.status === 403) return false;
    return null;
  }

  return {
    async verify(apiKey) {
      const hashed = hashApiKey(apiKey);

      const cached = cache.get(hashed);
      if (cached && Date.now() < cached.expiresAt) return cached.valid;

      // Collapse concurrent checks of the same key into one upstream request,
      // so a flood of initialize calls cannot be amplified into a flood of
      // LangWatch API calls.
      const pending = inFlight.get(hashed);
      if (pending) return pending;

      const request = askApi(apiKey)
        .then((result) => {
          // A null result means the API could not answer. Reject the request
          // but do not cache, so a transient upstream failure does not pin the
          // key into the negative cache.
          if (result !== null) remember(hashed, result);
          return result === true;
        })
        .finally(() => {
          inFlight.delete(hashed);
        });

      inFlight.set(hashed, request);
      return request;
    },
    sweep,
    clear() {
      cache.clear();
      inFlight.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

export interface SessionRecord<TTransport> {
  transport: TTransport;
  apiKey: string;
  lastActivityAt: number;
}

export interface SessionStore<TTransport> {
  get(sessionId: string): SessionRecord<TTransport> | undefined;
  add(sessionId: string, transport: TTransport, apiKey: string): void;
  /** Marks a session as active so the reaper leaves it alone. */
  touch(sessionId: string): void;
  /** Removes a session without closing its transport. */
  remove(sessionId: string): void;
  /** Number of live sessions held for this key. */
  countForKey(apiKey: string): number;
  /** Closes and removes sessions idle for longer than the max age. */
  sweep(): void;
  /** Closes and removes every session. */
  closeAll(): void;
  readonly size: number;
}

export function createSessionStore<TTransport>({
  maxAgeMs,
  closeTransport,
}: {
  maxAgeMs: number;
  closeTransport: (transport: TTransport) => void;
}): SessionStore<TTransport> {
  // A Map rather than a plain object: session ids come from request headers,
  // and an object would let `__proto__` reach the prototype chain.
  const sessions = new Map<string, SessionRecord<TTransport>>();
  const countByKey = new Map<string, number>();

  function decrement(apiKey: string): void {
    const hashed = hashApiKey(apiKey);
    const next = (countByKey.get(hashed) ?? 1) - 1;
    if (next <= 0) countByKey.delete(hashed);
    else countByKey.set(hashed, next);
  }

  function drop(sessionId: string, record: SessionRecord<TTransport>): void {
    sessions.delete(sessionId);
    decrement(record.apiKey);
  }

  return {
    get(sessionId) {
      return sessions.get(sessionId);
    },
    add(sessionId, transport, apiKey) {
      const existing = sessions.get(sessionId);
      if (existing) drop(sessionId, existing);

      sessions.set(sessionId, { transport, apiKey, lastActivityAt: Date.now() });
      const hashed = hashApiKey(apiKey);
      countByKey.set(hashed, (countByKey.get(hashed) ?? 0) + 1);
    },
    touch(sessionId) {
      const record = sessions.get(sessionId);
      if (record) record.lastActivityAt = Date.now();
    },
    remove(sessionId) {
      const record = sessions.get(sessionId);
      if (record) drop(sessionId, record);
    },
    countForKey(apiKey) {
      return countByKey.get(hashApiKey(apiKey)) ?? 0;
    },
    sweep() {
      const now = Date.now();
      for (const [sessionId, record] of sessions) {
        if (now - record.lastActivityAt > maxAgeMs) {
          drop(sessionId, record);
          closeTransport(record.transport);
        }
      }
    },
    closeAll() {
      for (const [sessionId, record] of sessions) {
        drop(sessionId, record);
        closeTransport(record.transport);
      }
    },
    get size() {
      return sessions.size;
    },
  };
}
