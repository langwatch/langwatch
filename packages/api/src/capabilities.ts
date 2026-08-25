import { createLogger } from "@langwatch/observability";
import type { Context, MiddlewareHandler } from "hono";

import type { RateLimiter, ResponseCache } from "./ports.js";

// ---------------------------------------------------------------------------
// Port-backed capabilities (ADR 003)
//
// The framework owns the keys and the pipeline positions; the application owns
// the substrate behind the ports. Both failure modes are deliberate: a limiter
// failure is logged and propagated (the port decides open or closed), a cache
// failure degrades to a handler call.
// ---------------------------------------------------------------------------

const logger = createLogger("langwatch:api:capabilities");

/** The context key the cache read uses to hand its key to the cache write. */
const RESPONSE_CACHE_KEY = "responseCacheKey";

/**
 * Rate limiting runs after auth and before validation: an over-limit caller
 * costs a key lookup, not a parse. Answers 429 with `Retry-After` when the
 * limiter supplies one.
 */
export function rateLimitMiddleware({
  rateLimiter,
  keyParts,
}: {
  rateLimiter: RateLimiter;
  /** Service name, endpoint path and version namespace — fixed at mount time. */
  keyParts: { service: string; path: string; version: string };
}): MiddlewareHandler {
  return async (c, next) => {
    const principal = rateLimitPrincipal(c);
    const key = `${keyParts.service}:${keyParts.path}:${keyParts.version}:${principal}`;

    let decision: { allowed: boolean; retryAfterSeconds?: number };
    try {
      decision = await rateLimiter.check(key);
    } catch (error) {
      logger.error({ error, rateLimitKey: key }, "rate limiter failed; propagating");
      throw error;
    }

    if (!decision.allowed) {
      if (decision.retryAfterSeconds !== undefined) {
        c.header("Retry-After", String(decision.retryAfterSeconds));
      }
      return c.json(
        {
          code: "rate_limited",
          message: "rate_limited",
          kind: "rate_limited",
          type: "rate_limited",
        },
        429,
      );
    }

    await next();
  };
}

/**
 * Auth adapters expose different identity fields. Prefer the credential itself
 * so two keys for one project retain independent principal budgets, then fall
 * back through user, organization and project identities.
 */
function rateLimitPrincipal(c: Context): string {
  const apiKeyId = c.get("apiKeyId") as string | undefined;
  if (apiKeyId) return apiKeyId;
  const resolved = c.get("resolvedToken") as
    | { apiKeyId?: string; id?: string }
    | undefined;
  if (resolved?.apiKeyId) return resolved.apiKeyId;
  if (resolved?.id) return resolved.id;
  const userId = (c.get("user") as { id?: string } | undefined)?.id;
  if (userId) return userId;
  const organizationId = (c.get("organization") as { id?: string } | undefined)?.id;
  if (organizationId) return organizationId;
  const projectId = (c.get("project") as { id?: string } | undefined)?.id;
  if (projectId) return projectId;
  return "anonymous";
}

/**
 * The cache key is the complete call: endpoint name, version namespace and a
 * hash of the validated input body. RPC endpoints put every argument in the
 * body, which is what makes caching POST responses sound.
 */
export function cacheKeyFor({
  service,
  path,
  version,
  input,
}: {
  service: string;
  path: string;
  version: string;
  input: unknown;
}): string {
  return `${service}:${path}:${version}:${fnv1a(stableStringify(input))}`;
}

/**
 * The cache read: after validation, before the handler. A hit serves the
 * validated bytes without running the handler or the output schema — they ran
 * when the entry was written. The key is stashed on the context so the write
 * side of the pipeline stores under the very key that was missed.
 */
export function cacheReadMiddleware({
  cache,
  keyParts,
  hasInput,
  declaredStatus,
}: {
  cache: ResponseCache;
  keyParts: { service: string; path: string; version: string };
  hasInput: boolean;
  /**
   * The endpoint's declared success status, replayed verbatim on a hit. The
   * defaults mirror `serializeEndpointResult`: 204 for a no-body endpoint,
   * 200 otherwise.
   */
  declaredStatus?: number;
}): MiddlewareHandler {
  return async (c, next) => {
    const input = hasInput ? c.req.valid("json" as never) : undefined;
    const key = cacheKeyFor({ ...keyParts, input });
    c.set(RESPONSE_CACHE_KEY, key);

    let cached: Uint8Array | null;
    try {
      cached = await cache.get(key);
    } catch (error) {
      logger.error(
        { error, cacheKey: key },
        "response cache read failed; running handler",
      );
      await next();
      return;
    }

    if (cached) {
      if (cached.byteLength === 0) {
        return c.body(null, (declaredStatus ?? 204) as 200);
      }
      return new Response(cached as unknown as BodyInit, {
        status: declaredStatus ?? 200,
        headers: { "content-type": "application/json" },
      });
    }

    await next();
  };
}

/**
 * The cache write, called from the handler middleware once the response is
 * serialized: only validated bytes are stored — a handler that built its own
 * `Response` bypassed output validation, so its bytes are never cached.
 */
export async function writeCachedResponse({
  c,
  cache,
  cacheConfig,
  response,
}: {
  c: Context;
  cache: ResponseCache;
  cacheConfig: { tag: string; ttlSeconds: number };
  response: Response;
}): Promise<void> {
  const key = c.get(RESPONSE_CACHE_KEY) as string | undefined;
  if (!key) return;

  try {
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    await cache.set(key, cacheConfig.tag, bytes, cacheConfig.ttlSeconds);
  } catch (error) {
    logger.error(
      { error, cacheKey: key },
      "response cache write failed; response already served",
    );
  }
}

// ---------------------------------------------------------------------------
// Stable hashing of the validated input
// ---------------------------------------------------------------------------

/** JSON with object keys sorted, so equal calls hash equal regardless of key order. */
function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
    );
  return `{${entries.join(",")}}`;
}

/** FNV-1a: dependency-free and stable across runtimes (node and edge alike). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
