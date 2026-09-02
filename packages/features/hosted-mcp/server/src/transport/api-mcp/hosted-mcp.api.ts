/**
 * MCP HTTP handler for the in-app Streamable HTTP transport.
 *
 * Mounts MCP routes inside the main LangWatch app's custom Node.js server,
 * handling authentication via Bearer tokens (direct API keys or OAuth-issued
 * access tokens), session management, and CORS.
 *
 * Routes handled:
 * - POST /mcp          — Streamable HTTP initialize/requests
 * - GET  /mcp          — Streamable HTTP polling
 * - DELETE /mcp        — Close session
 * - GET  /mcp/health   — Health check (no auth)
 * - GET  /sse          — SSE transport stream
 * - POST /messages, /sse/messages — SSE transport client messages
 * - GET  /.well-known/oauth-protected-resource[/mcp|/sse] — RFC 9728 metadata
 * - GET  /.well-known/oauth-authorization-server[/mcp|/sse] — OAuth metadata
 * - POST /oauth/register — Dynamic client registration
 * - POST /oauth/token  — OAuth token endpoint
 */

// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getConfig, initConfig, runWithConfig } from "@langwatch/mcp-server/config";
import { createMcpServer } from "@langwatch/mcp-server/create-mcp-server";
import { createLogger } from "@langwatch/observability";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { HostedMcpRedis } from "../../ports/hosted-mcp.port";
import type { HostedMcpDependencies } from "../../ports/hosted-mcp.port";
import {
  getOAuthClient,
  registerOAuthClient,
} from "../../repositories/redis/redis.oauth-client.repository";

const logger = createLogger("langwatch:mcp");

/** Redis key prefix for OAuth tokens. */
const REDIS_TOKEN_PREFIX = "mcp:oauth:token:";

/** Redis key prefix for MCP authorization codes. */
const REDIS_AUTH_CODE_PREFIX = "mcp:auth_code:";

/** Redis key prefix for MCP transport sessions. */
const REDIS_SESSION_PREFIX = "mcp:session:";

/** Redis key for the set of session IDs belonging to an API key. */
const REDIS_SESSION_SET_PREFIX = "mcp:sessions_by_key:";

/** Redis key prefix for SSE transport sessions. */
const REDIS_SSE_SESSION_PREFIX = "mcp:sse:session:";

/** Redis key for the set of SSE session IDs belonging to an API key. */
const REDIS_SSE_SESSION_SET_PREFIX = "mcp:sse:sessions_by_key:";

/**
 * Redis pub/sub channel prefix carrying a client message to whichever replica
 * holds the SSE stream for that session. An SSE stream is bound to the socket
 * that opened it, so a replica that receives a message for a session it does
 * not hold cannot answer it and cannot recreate the stream either.
 */
const REDIS_SSE_RELAY_CHANNEL_PREFIX = "mcp:sse:relay:";

/** OAuth token TTL in seconds (30 days — matches cookie-based login duration). */
const TOKEN_TTL_SECONDS = 30 * 24 * 3600;

/** Max concurrent sessions per API key. */
const MAX_SESSIONS_PER_KEY = 20;

/**
 * Derive an opaque key from an API key for use in Redis key names.
 * Raw API keys must never appear in key names — they're visible in
 * admin tools, MONITOR, key dumps, and metrics.
 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Rate limiter — sliding window per IP
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

function createRateLimiter({
  windowMs,
  maxRequests,
}: {
  windowMs: number;
  maxRequests: number;
}) {
  const entries = new Map<string, RateLimitEntry>();

  return {
    /** Check if the IP is within the rate limit (does NOT increment). */
    isBlocked(ip: string): boolean {
      const now = Date.now();
      const entry = entries.get(ip);
      if (!entry || now - entry.windowStart > windowMs) return false;
      return entry.count >= maxRequests;
    },
    /** Record a request for this IP (increments the counter). */
    track(ip: string): void {
      const now = Date.now();
      const entry = entries.get(ip);
      if (!entry || now - entry.windowStart > windowMs) {
        entries.set(ip, { count: 1, windowStart: now });
      } else {
        entry.count++;
      }
    },
    /** Remove expired entries (call from reaper). */
    sweep() {
      const now = Date.now();
      for (const [ip, entry] of entries) {
        if (now - entry.windowStart > windowMs) {
          entries.delete(ip);
        }
      }
    },
    /** Drop every tracked entry (for testing). */
    clear() {
      entries.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Request logging
// ---------------------------------------------------------------------------

/**
 * Fields a route handler learned mid-request that belong on its access log
 * line. MCP requests return before the app's Hono stack, so this surface has
 * no access log of its own and a failing integration is otherwise invisible.
 *
 * Only identifiers go in here. Bearer tokens, API keys and authorization codes
 * never do: the log is the one place they would outlive the request.
 */
const requestLogFields = new WeakMap<ServerResponse, Record<string, string>>();

function noteLogFields(
  res: ServerResponse,
  fields: Record<string, string | undefined>,
): void {
  const existing = requestLogFields.get(res) ?? {};
  for (const [key, value] of Object.entries(fields)) {
    if (value) existing[key] = value;
  }
  requestLogFields.set(res, existing);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-session state for Streamable HTTP transport. */
interface SessionState {
  transport: StreamableHTTPServerTransport;
  apiKey: string;
  /**
   * The OAuth-flowing user — populated when the session was minted via the
   * /api/mcp/authorize PKCE flow, absent for direct-apiKey-as-Bearer sessions.
   * Used by governance MCP tools to attribute audit rows + enforce RBAC at
   * the tool layer.
   */
  userId?: string;
  lastActivityAt: number;
}

/** Per-session state for SSE transport. */
interface SseSessionState {
  transport: SSEServerTransport;
  apiKey: string;
  userId?: string;
  lastActivityAt: number;
}

/** OAuth token entry stored in memory and Redis. */
interface OAuthTokenEntry {
  apiKey: string;
  /** OAuth-flowing user id captured at /mcp/authorize. */
  userId?: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface McpHandler {
  /** Handle an incoming HTTP request for MCP routes. Returns true if handled. */
  handleRequest: (req: IncomingMessage, res: ServerResponse) => void;
  /** Returns true if the given pathname is an MCP route. */
  isMcpRoute: (pathname: string) => boolean;
  /** Clear the in-memory OAuth token cache (for testing). */
  clearTokenCache: () => void;
  /** Clear the in-memory OAuth/auth-failure rate limiter state (for testing). */
  clearRateLimiters: () => void;
  /** Close all active sessions and release their records (graceful shutdown). */
  closeAllSessions: () => Promise<void>;
}

/**
 * Creates an MCP handler instance that manages sessions, OAuth tokens,
 * and routes for the Streamable HTTP transport.
 *
 * Every collaborator is handed in. The endpoint used to reach a process-global
 * application object for its Redis connection, its database and its governance
 * service, which made it impossible to mount twice, impossible to test without
 * booting that object, and impossible to tell from the outside what it
 * actually touched.
 */
export function createMcpHandler(dependencies: HostedMcpDependencies): McpHandler {
  // Resolved once, here: the connection does not change for the life of the
  // process. Null means no Redis is configured, and every use below branches on
  // it — but not all the same way (ADR-093). Session storage degrades to the
  // in-memory map, so a single process keeps working; the OAuth
  // authorization-code exchange cannot, because the code is written by whichever
  // process served the authorize request, so it answers 500 instead.
  const { redis, projects, cipher, address, sessionTools } = dependencies;
  const encrypt = (plaintext: string): string => cipher.encrypt(plaintext);
  const decrypt = (ciphertext: string): string => cipher.decrypt(ciphertext);

  // Ensure the MCP config is initialized with this deployment's endpoint
  try {
    getConfig();
  } catch {
    initConfig({ endpoint: dependencies.baseHost });
  }

  // Use Map to avoid prototype pollution — sessionId comes from user input
  const sessions = new Map<string, SessionState>();
  const sseSessions = new Map<string, SseSessionState>();
  const oauthTokens = new Map<string, OAuthTokenEntry>();

  // Rate limiters. Registration and token exchange get a budget each: a
  // client that just registered immediately exchanges a code, so one shared
  // bucket makes the second call pay for the first.
  const registerRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
  });
  const tokenRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
  });
  const authFailRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
  });

  // -------------------------------------------------------------------------
  // Session & token reaper — prevents unbounded memory from abandoned sessions
  // and never-used OAuth tokens.
  // -------------------------------------------------------------------------

  const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes (local transport cleanup)
  const SESSION_REDIS_TTL_SECONDS = TOKEN_TTL_SECONDS; // Match OAuth token TTL (30 days) — session metadata is tiny, no reason to expire it sooner
  const REAPER_INTERVAL_MS = 60 * 1000; // 60 seconds

  const reaper = setInterval(() => {
    const now = Date.now();

    // Sweep idle local transports (Redis entries expire via TTL)
    for (const [id, session] of sessions) {
      if (now - session.lastActivityAt > SESSION_MAX_AGE_MS) {
        session.transport.close().catch(() => {});
        sessions.delete(id);
        removeSessionFromRedis(id, session.apiKey).catch(() => {});
      }
    }

    // Sweep idle SSE sessions. The stream itself is connection-bound, but the
    // Redis record and the relay subscription that let other replicas reach it
    // have to go with it.
    for (const [id, session] of sseSessions) {
      if (now - session.lastActivityAt > SESSION_MAX_AGE_MS) {
        session.transport.close().catch(() => {});
        releaseSseSession(id, session.apiKey).catch(() => {});
      }
    }

    // Sweep expired in-memory OAuth token cache (Redis is source of truth)
    for (const [token, entry] of oauthTokens) {
      if (now >= entry.expiresAt) {
        oauthTokens.delete(token);
      }
    }

    // Sweep expired rate limiter entries
    registerRateLimiter.sweep();
    tokenRateLimiter.sweep();
    authFailRateLimiter.sweep();
  }, REAPER_INTERVAL_MS);

  // Allow the process to exit naturally even if the reaper is still scheduled
  reaper.unref();

  // -------------------------------------------------------------------------
  // Route matching
  // -------------------------------------------------------------------------

  const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
  const AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";

  const MCP_ROUTES = new Set([
    "/mcp",
    "/mcp/health",
    "/sse",
    "/messages",
    // Some clients resolve the endpoint the SSE stream advertises by appending
    // it to the path they connected on, so the same handler answers both.
    "/sse/messages",
    PROTECTED_RESOURCE_METADATA_PATH,
    AUTHORIZATION_SERVER_METADATA_PATH,
    "/.well-known/openid-configuration",
    "/oauth/token",
    "/oauth/register",
  ]);

  /**
   * RFC 9728 §3.1 lets a client that only knows the resource URL ask for
   * metadata at the resource's path under the well-known prefix, and modern
   * MCP clients try that form before the bare one. Claiming the whole subtree
   * keeps those probes from reaching the single-page-app fallback, which
   * answers 200 text/html and leaves the client parsing markup as JSON.
   */
  const OAUTH_METADATA_PREFIXES = [
    `${PROTECTED_RESOURCE_METADATA_PATH}/`,
    `${AUTHORIZATION_SERVER_METADATA_PATH}/`,
  ];

  function isMcpRoute(pathname: string): boolean {
    if (MCP_ROUTES.has(pathname)) return true;
    return OAUTH_METADATA_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  }

  /** The resource paths whose metadata this server publishes. */
  const METADATA_RESOURCE_SUFFIXES = new Set(["/mcp", "/sse"]);

  // -------------------------------------------------------------------------
  // CORS — Access-Control-Allow-Origin: * is intentional; the Bearer token
  // provides the security boundary, not the origin.
  // -------------------------------------------------------------------------

  function setCorsHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, MCP-Protocol-Version",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  }

  // -------------------------------------------------------------------------
  // JSON helpers
  // -------------------------------------------------------------------------

  function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  const MAX_BODY_BYTES = 10_485_760; // 10 MB

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let rejected = false;
      req.on("data", (chunk: Buffer) => {
        if (rejected) return;
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
          rejected = true;
          reject(new Error("Request body too large"));
          req.resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (!rejected) resolve(Buffer.concat(chunks).toString("utf-8"));
      });
      req.on("error", reject);
    });
  }

  /**
   * Reads a request body, answering the caller itself when it is too large.
   * Returns `undefined` in that case — a response has already been sent and
   * the caller must stop. Bodies that need their own parse failure (the form
   * readers each answer with a different OAuth error) build on this.
   */
  async function readRawBody(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<string | undefined> {
    try {
      return await readBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === "Request body too large") {
        sendJson(res, 413, { error: "Request body too large" });
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Reads and parses a JSON request body, answering the caller itself when the
   * body is unusable. Returns `undefined` in that case — a response has
   * already been sent and the caller must stop.
   */
  async function readJsonBody(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<unknown | undefined> {
    const raw = await readRawBody(req, res);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return undefined;
    }
  }

  function parseFormBody(raw: string): Record<string, string> {
    const params = new URLSearchParams(raw);
    const result: Record<string, string> = {};
    for (const [key, value] of params) {
      result[key] = value;
    }
    return result;
  }

  /**
   * The rate-limit bucket for a caller.
   *
   * The socket address alone is the load balancer for every caller once the
   * app runs behind Cloudflare and an NLB, which collapses every client in the
   * world into one bucket and lets a single busy integration lock everyone
   * else out. The proxy headers are the only per-client signal that survives
   * that hop, so they are what we key on, with the socket address as the
   * fallback for direct connections. Shares the header priority (and the
   * address validation) with the rest of the app rather than re-deriving it.
   *
   * That priority puts `cf-connecting-ip` first, which is the header the edge
   * writes itself: Cloudflare replaces any caller-supplied value before the
   * request reaches an origin, so what we bucket on is edge-authored rather
   * than caller-authored wherever the deployment keeps that edge in front. A
   * deployment that exposes the origin directly is trusting these headers to
   * the same degree as every other rate limit in the app, which is why the
   * resolution stays shared instead of being re-derived here.
   */
  function getClientIp(req: IncomingMessage): string {
    return address.clientIp(req);
  }

  /**
   * RFC 6749 §5.2 shape for a throttled OAuth request. A bare
   * `{"error":"Too many requests"}` is not an OAuth error object, so clients
   * report it as a protocol failure instead of backing off.
   */
  function sendRateLimited(res: ServerResponse, retryAfterSeconds = 60): void {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    sendJson(res, 429, {
      error: "temporarily_unavailable",
      error_description: "Rate limit exceeded, retry later",
    });
  }

  // -------------------------------------------------------------------------
  // Token resolution
  // -------------------------------------------------------------------------

  function extractBearerToken(req: IncomingMessage): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return null;
    return authHeader.slice(7) || null;
  }

  /**
   * Resolves a Bearer token to an API key (legacy single-value return).
   * Prefer `resolveSessionContext` for new code that needs the OAuth
   * user identity alongside the apiKey.
   */
  async function resolveApiKey(token: string): Promise<string | null> {
    const ctx = await resolveSessionContext(token);
    return ctx?.apiKey ?? null;
  }

  /**
   * Resolves a Bearer token to {apiKey, userId?}. The userId is set when
   * the token was minted via the /mcp/authorize OAuth flow (we capture
   * `session.user.id` at code creation), and undefined when the token is
   * a direct project apiKey passed as Bearer. Governance MCP tools that
   * need a caller identity (audit attribution, RBAC) read userId from
   * here; tools that only need org context can ignore it.
   */
  async function resolveSessionContext(
    token: string,
  ): Promise<{ apiKey: string; userId?: string } | null> {
    // 1. Check in-memory OAuth token cache
    const memEntry = oauthTokens.get(token);
    if (memEntry) {
      if (Date.now() < memEntry.expiresAt) {
        return { apiKey: memEntry.apiKey, userId: memEntry.userId };
      }
      oauthTokens.delete(token);
      return null;
    }

    // 2. Check Redis for OAuth token (API key is encrypted at rest)
    if (redis) {
      try {
        const redisData = await redis.get(`${REDIS_TOKEN_PREFIX}${token}`);
        if (redisData) {
          const stored = JSON.parse(redisData) as {
            encryptedApiKey: string;
            userId?: string;
            expiresAt: number;
          };
          if (Date.now() < stored.expiresAt) {
            const apiKey = decrypt(stored.encryptedApiKey);
            // Re-populate in-memory cache
            oauthTokens.set(token, {
              apiKey,
              userId: stored.userId,
              expiresAt: stored.expiresAt,
            });
            return { apiKey, userId: stored.userId };
          }
          await redis.del(`${REDIS_TOKEN_PREFIX}${token}`);
          return null;
        }
      } catch (err) {
        // Redis is down — fall through to treat token as a direct API key.
        // This is safe because validateApiKey() will still check the key
        // against the database, rejecting any invalid tokens.
        logger.error({ error: err }, "Redis token lookup failed");
      }
    }

    // 3. Treat as direct API key (only reached when token was not found in
    //    either the in-memory cache or Redis). No OAuth user identity.
    return { apiKey: token };
  }

  /**
   * Validates an API key against the database.
   * Returns the project if valid, null otherwise.
   */
  async function validateApiKey(
    apiKey: string,
  ): Promise<{ id: string; teamId: string } | null> {
    try {
      return await projects.findLiveProjectByApiKey({ apiKey });
    } catch (err) {
      logger.error({ error: err }, "Database API key validation failed");
      return null;
    }
  }

  /**
   * Full auth flow: extract Bearer token, resolve to API key, validate
   * against DB. Returns the API key if valid, or sends a 401 and returns null.
   */
  function send401(res: ServerResponse, error: string): void {
    const baseUrl = process.env.BASE_HOST ?? "https://app.langwatch.ai";
    res.setHeader(
      "WWW-Authenticate",
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    );
    sendJson(res, 401, { error });
  }

  async function authenticateRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<string | null> {
    const token = extractBearerToken(req);
    if (!token) {
      send401(res, "Authorization required");
      return null;
    }

    const apiKey = await resolveApiKey(token);
    if (!apiKey) {
      authFailRateLimiter.track(getClientIp(req));
      send401(res, "Invalid or expired token");
      return null;
    }

    const project = await validateApiKey(apiKey);
    if (!project) {
      authFailRateLimiter.track(getClientIp(req));
      send401(res, "Invalid API key");
      return null;
    }

    return apiKey;
  }

  // -------------------------------------------------------------------------
  // runWithConfig wrapper
  // -------------------------------------------------------------------------

  async function handleWithSessionConfig<T>(
    apiKey: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const baseConfig = getConfig();
    logger.debug(
      { hasApiKey: !!apiKey, endpoint: baseConfig.endpoint },
      "Running with session config",
    );
    return runWithConfig({ ...baseConfig, apiKey }, fn);
  }

  // -------------------------------------------------------------------------
  // OAuth token generation
  // -------------------------------------------------------------------------

  function generateAccessToken(): string {
    return createHash("sha256").update(randomUUID()).digest("hex");
  }

  async function storeOAuthToken(
    accessToken: string,
    apiKey: string,
    expiresIn: number,
    userId?: string,
  ): Promise<void> {
    const entry: OAuthTokenEntry = {
      apiKey,
      userId,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    // Store in memory (plaintext — process-local, not persisted)
    oauthTokens.set(accessToken, entry);

    // Store in Redis with encrypted API key
    if (redis) {
      try {
        const redisEntry = JSON.stringify({
          encryptedApiKey: encrypt(apiKey),
          userId,
          expiresAt: entry.expiresAt,
        });
        await redis.set(
          `${REDIS_TOKEN_PREFIX}${accessToken}`,
          redisEntry,
          "EX",
          expiresIn,
        );
      } catch (err) {
        logger.error({ error: err }, "Failed to store OAuth token in Redis");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Redis session helpers
  // -------------------------------------------------------------------------

  /** Store session metadata in Redis so other pods can serve it. */
  async function storeSessionInRedis(sessionId: string, apiKey: string): Promise<void> {
    if (!redis) return;
    try {
      const data = JSON.stringify({
        encryptedApiKey: encrypt(apiKey),
        createdAt: Date.now(),
      });
      await redis.set(
        `${REDIS_SESSION_PREFIX}${sessionId}`,
        data,
        "EX",
        SESSION_REDIS_TTL_SECONDS,
      );
      // Track session ID in a per-key set for counting
      await redis.sadd(`${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`, sessionId);
      await redis.expire(
        `${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`,
        SESSION_REDIS_TTL_SECONDS,
      );
    } catch (err) {
      logger.error({ error: err }, "Failed to store session in Redis");
    }
  }

  /** Refresh the Redis TTL when a session is active (called on each request). */
  async function touchSessionInRedis(sessionId: string, apiKey: string): Promise<void> {
    if (!redis) return;
    try {
      await redis.expire(
        `${REDIS_SESSION_PREFIX}${sessionId}`,
        SESSION_REDIS_TTL_SECONDS,
      );
      await redis.expire(
        `${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`,
        SESSION_REDIS_TTL_SECONDS,
      );
    } catch {
      // Non-critical — the session will still work until Redis TTL expires
    }
  }

  /** Look up session metadata from Redis (returns apiKey or null). */
  async function getSessionFromRedis(sessionId: string): Promise<string | null> {
    if (!redis) return null;
    try {
      const data = await redis.get(`${REDIS_SESSION_PREFIX}${sessionId}`);
      if (!data) return null;
      const stored = JSON.parse(data) as { encryptedApiKey: string };
      return decrypt(stored.encryptedApiKey);
    } catch (err) {
      logger.error({ error: err }, "Redis session lookup failed");
      return null;
    }
  }

  /** Remove session from Redis. */
  async function removeSessionFromRedis(
    sessionId: string,
    apiKey: string,
  ): Promise<void> {
    if (!redis) return;
    try {
      await redis.del(`${REDIS_SESSION_PREFIX}${sessionId}`);
      await redis.srem(`${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`, sessionId);
    } catch {
      // Best-effort cleanup
    }
  }

  /** Count live sessions of one transport for an API key across all pods. */
  async function countLiveSessions({
    setKey,
    sessionPrefix,
  }: {
    setKey: string;
    sessionPrefix: string;
  }): Promise<number> {
    if (!redis) return 0;
    const members = await redis.smembers(setKey);
    let liveCount = 0;
    for (const id of members) {
      const exists = await redis.exists(`${sessionPrefix}${id}`);
      if (exists) {
        liveCount++;
      } else {
        // Stale entry — session expired, clean it from the set
        await redis.srem(setKey, id);
      }
    }
    return liveCount;
  }

  /** Count sessions for an API key across all pods via Redis. */
  async function sessionCountForKey(apiKey: string): Promise<number> {
    if (!redis) {
      // Fallback to local count if Redis is down
      let count = 0;
      for (const session of sessions.values()) {
        if (session.apiKey === apiKey) count++;
      }
      for (const session of sseSessions.values()) {
        if (session.apiKey === apiKey) count++;
      }
      return count;
    }
    try {
      const keyHash = hashApiKey(apiKey);
      const streamable = await countLiveSessions({
        setKey: `${REDIS_SESSION_SET_PREFIX}${keyHash}`,
        sessionPrefix: REDIS_SESSION_PREFIX,
      });
      const sse = await countLiveSessions({
        setKey: `${REDIS_SSE_SESSION_SET_PREFIX}${keyHash}`,
        sessionPrefix: REDIS_SSE_SESSION_PREFIX,
      });
      return streamable + sse;
    } catch (err) {
      logger.error({ error: err }, "Redis session count failed");
      return 0; // Fail open to avoid blocking users
    }
  }

  // -------------------------------------------------------------------------
  // SSE session records and the cross-replica message relay
  // -------------------------------------------------------------------------

  /**
   * Lifetime of an SSE session record, matching the idle reap. A replica that
   * dies without closing its streams leaves records behind, and this is what
   * eventually clears them.
   */
  const SSE_SESSION_REDIS_TTL_SECONDS = SESSION_MAX_AGE_MS / 1000;

  /**
   * Dedicated subscriber connection. ioredis puts a connection into subscriber
   * mode, where it can run no other command, so the relay cannot share the
   * app's connection. One per handler covers every session it holds.
   */
  let relaySubscriber: HostedMcpRedis | null = null;
  const relayListeners = new Map<string, (raw: string) => void>();

  function getRelaySubscriber(): HostedMcpRedis | null {
    if (relaySubscriber) return relaySubscriber;
    if (!redis) return null;
    try {
      // Cluster.duplicate() takes optional overrides and returns a Cluster;
      // both shapes answer subscribe/unsubscribe/on identically.
      const subscriber = (redis.duplicate as () => HostedMcpRedis)();
      subscriber.on("message", (channel: string, message: string) => {
        relayListeners.get(channel)?.(message);
      });
      subscriber.on("error", (err: unknown) => {
        logger.error({ error: err }, "MCP SSE relay subscriber error");
      });
      relaySubscriber = subscriber;
      return subscriber;
    } catch (err) {
      logger.error({ error: err }, "Failed to open MCP SSE relay subscriber");
      return null;
    }
  }

  function relayChannel(sessionId: string): string {
    return `${REDIS_SSE_RELAY_CHANNEL_PREFIX}${sessionId}`;
  }

  /** Record an SSE session so other replicas can find and reach it. */
  async function storeSseSessionInRedis(
    sessionId: string,
    apiKey: string,
  ): Promise<void> {
    if (!redis) return;
    const setKey = `${REDIS_SSE_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`;
    await redis.set(
      `${REDIS_SSE_SESSION_PREFIX}${sessionId}`,
      JSON.stringify({
        encryptedApiKey: encrypt(apiKey),
        createdAt: Date.now(),
      }),
      "EX",
      SSE_SESSION_REDIS_TTL_SECONDS,
    );
    await redis.sadd(setKey, sessionId);
    await redis.expire(setKey, SSE_SESSION_REDIS_TTL_SECONDS);
  }

  /** Keep an active SSE session from being reaped, wherever it is driven from. */
  async function touchSseSessionInRedis(
    sessionId: string,
    apiKey: string,
  ): Promise<void> {
    if (!redis) return;
    try {
      await redis.expire(
        `${REDIS_SSE_SESSION_PREFIX}${sessionId}`,
        SSE_SESSION_REDIS_TTL_SECONDS,
      );
      await redis.expire(
        `${REDIS_SSE_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`,
        SSE_SESSION_REDIS_TTL_SECONDS,
      );
    } catch {
      // Non-critical — the session still works until the TTL expires
    }
  }

  async function getSseSessionFromRedis(sessionId: string): Promise<string | null> {
    if (!redis) return null;
    try {
      const data = await redis.get(`${REDIS_SSE_SESSION_PREFIX}${sessionId}`);
      if (!data) return null;
      const stored = JSON.parse(data) as { encryptedApiKey: string };
      return decrypt(stored.encryptedApiKey);
    } catch (err) {
      logger.error({ error: err }, "Redis SSE session lookup failed");
      return null;
    }
  }

  async function removeSseSessionFromRedis(
    sessionId: string,
    apiKey?: string,
  ): Promise<void> {
    if (!redis) return;
    try {
      await redis.del(`${REDIS_SSE_SESSION_PREFIX}${sessionId}`);
      if (apiKey) {
        await redis.srem(
          `${REDIS_SSE_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`,
          sessionId,
        );
      }
    } catch {
      // Best-effort cleanup
    }
  }

  /** Drop every trace of an SSE session: local map, relay subscription, Redis. */
  async function releaseSseSession(sessionId: string, apiKey: string): Promise<void> {
    sseSessions.delete(sessionId);
    const channel = relayChannel(sessionId);
    relayListeners.delete(channel);
    if (relaySubscriber) {
      await relaySubscriber.unsubscribe(channel).catch(() => {});
    }
    await removeSseSessionFromRedis(sessionId, apiKey);
  }

  // -------------------------------------------------------------------------
  // Route handlers
  // -------------------------------------------------------------------------

  function handleHealthCheck(_req: IncomingMessage, res: ServerResponse): void {
    sendJson(res, 200, { status: "ok" });
  }

  /**
   * `resourceSuffix` is the resource path a client asked about when it used
   * the RFC 9728 path-suffixed form. It is echoed back as the `resource`
   * identifier so a client validating the document against the URL it is
   * about to call finds them equal.
   */
  function handleProtectedResourceMetadata(
    _req: IncomingMessage,
    res: ServerResponse,
    resourceSuffix = "",
  ): void {
    const baseUrl = process.env.BASE_HOST ?? "https://app.langwatch.ai";

    sendJson(res, 200, {
      resource: `${baseUrl}${resourceSuffix}`,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:tools"],
    });
  }

  /**
   * Answers the OAuth discovery subtree this server claims but does not
   * publish a document for. Falling through to the single-page app would give
   * the client 200 text/html; a JSON 404 is what lets it move on to the
   * document that does exist.
   */
  function handleUnknownMetadata(res: ServerResponse): void {
    sendJson(res, 404, {
      error: "not_found",
      error_description: "No metadata document is published at this path",
    });
  }

  function handleOAuthMetadata(_req: IncomingMessage, res: ServerResponse): void {
    // Use configured endpoint to prevent host header injection
    const baseUrl = process.env.BASE_HOST ?? "https://app.langwatch.ai";

    sendJson(res, 200, {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/mcp/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      registration_endpoint: `${baseUrl}/oauth/register`,
      token_endpoint_auth_methods_supported: ["none"],
      grant_types_supported: ["authorization_code"],
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:tools"],
    });
  }

  async function handleOAuthRegister(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const ip = getClientIp(req);
    if (registerRateLimiter.isBlocked(ip)) {
      sendRateLimited(res);
      return;
    }
    registerRateLimiter.track(ip);

    const raw = await readRawBody(req, res);
    if (raw === undefined) return;

    let body: {
      redirect_uris?: string[];
      client_name?: string;
      [key: string]: unknown;
    };
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "invalid_client_metadata" });
      return;
    }

    // RFC 7591: redirect_uris is REQUIRED for authorization_code grant
    if (
      !body.redirect_uris ||
      !Array.isArray(body.redirect_uris) ||
      body.redirect_uris.length === 0
    ) {
      sendJson(res, 400, {
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required",
      });
      return;
    }

    // Generate a client_id — we don't restrict which clients can use the
    // OAuth flow, so any registration succeeds. What DOES matter is binding
    // this client_id to the redirect_uris it registered with, so /mcp/authorize
    // can reject a request that later shows up with a different one.
    const clientId = `mcp_${randomUUID().replace(/-/g, "")}`;
    const clientName =
      typeof body.client_name === "string" ? body.client_name : "MCP Client";

    try {
      await registerOAuthClient({
        redis,
        clientId,
        client: { redirectUris: body.redirect_uris, clientName },
      });
    } catch (err) {
      logger.error({ error: err }, "Failed to persist OAuth client registration");
      sendJson(res, 500, { error: "server_error" });
      return;
    }

    noteLogFields(res, { clientId });

    sendJson(res, 201, {
      client_id: clientId,
      client_name: clientName,
      redirect_uris: body.redirect_uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  }

  /**
   * RFC 6749 §2.3.1 client credentials carried in an `Authorization: Basic`
   * header. Public clients registered here have no secret, so the password
   * half is expected to be empty and is not checked; the header is only
   * another place a client may put its `client_id`. Both halves are
   * form-urlencoded per the same section.
   */
  function clientIdFromBasicAuth(req: IncomingMessage): string | null {
    const header = req.headers.authorization;
    if (!header?.toLowerCase().startsWith("basic ")) return null;
    try {
      const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf-8");
      const separator = decoded.indexOf(":");
      const rawClientId = separator === -1 ? decoded : decoded.slice(0, separator);
      return decodeURIComponent(rawClientId) || null;
    } catch {
      return null;
    }
  }

  async function handleOAuthToken(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // Rate limit token endpoint per IP
    const ip = getClientIp(req);
    if (tokenRateLimiter.isBlocked(ip)) {
      sendRateLimited(res);
      return;
    }
    tokenRateLimiter.track(ip);

    const raw = await readRawBody(req, res);
    if (raw === undefined) return;
    const params = parseFormBody(raw);

    if (params.grant_type !== "authorization_code") {
      sendJson(res, 400, {
        error: "unsupported_grant_type",
        error_description: "Only authorization_code grant type is supported",
      });
      return;
    }

    const code = params.code;
    if (!code) {
      sendJson(res, 400, {
        error: "invalid_request",
        error_description: "code is required",
      });
      return;
    }

    const codeVerifier = params.code_verifier;
    if (!codeVerifier) {
      sendJson(res, 400, {
        error: "invalid_request",
        error_description: "code_verifier is required",
      });
      return;
    }

    // RFC 6749 §4.1.3: redirect_uri MUST be present here and MUST be
    // identical to the one used at the authorization request. §3.2.1: a
    // public client (this one — token_endpoint_auth_method "none") MUST
    // include client_id. Both are re-checked against what /mcp/authorize
    // bound to the code below, once it's decoded.
    const redirectUriParam = params.redirect_uri;
    if (!redirectUriParam) {
      sendJson(res, 400, {
        error: "invalid_request",
        error_description: "redirect_uri is required",
      });
      return;
    }
    const clientIdParam = params.client_id ?? clientIdFromBasicAuth(req);
    if (!clientIdParam) {
      sendJson(res, 400, {
        error: "invalid_request",
        error_description: "client_id is required",
      });
      return;
    }
    noteLogFields(res, { clientId: clientIdParam });

    // Look up auth code from Redis
    if (!redis) {
      sendJson(res, 500, { error: "server_error" });
      return;
    }

    const redisKey = `${REDIS_AUTH_CODE_PREFIX}${code}`;
    let authCodeData: string | null;
    try {
      authCodeData = await redis.get(redisKey);
    } catch (err) {
      logger.error({ error: err }, "Redis auth code lookup failed");
      sendJson(res, 500, { error: "server_error" });
      return;
    }

    if (!authCodeData) {
      // A registration that fell out of Redis takes its outstanding codes with
      // it, and both failures look the same from here. Telling a client whose
      // registration is gone that its *code* was bad sends it round the
      // authorize loop forever; `invalid_client` is the code that makes it
      // register again (RFC 6749 §5.2).
      const registeredClient = await getOAuthClient({ redis, clientId: clientIdParam }).catch(
        () => null,
      );
      if (!registeredClient) {
        sendJson(res, 401, {
          error: "invalid_client",
          error_description:
            "Unknown client_id — register again via dynamic client registration",
        });
        return;
      }
      sendJson(res, 400, {
        error: "invalid_grant",
        error_description: "Invalid or expired authorization code",
      });
      return;
    }

    // Delete the code immediately (one-time use)
    await redis.del(redisKey).catch((err: unknown) => {
      logger.error({ error: err }, "Failed to delete auth code from Redis");
    });

    let stored: {
      projectId: string;
      encryptedApiKey: string;
      userId?: string;
      codeChallenge: string;
      codeChallengeMethod: string;
      redirectUri: string;
      clientId: string;
      expiresAt: number;
    };
    try {
      stored = JSON.parse(authCodeData);
    } catch {
      sendJson(res, 400, {
        error: "invalid_grant",
        error_description: "Corrupted authorization code",
      });
      return;
    }

    // Bind the exchange to the exact client_id + redirect_uri /mcp/authorize
    // validated and recorded for this code — a code minted for one client's
    // registered URI must never be redeemable against a different one.
    if (stored.redirectUri !== redirectUriParam) {
      sendJson(res, 400, {
        error: "invalid_grant",
        error_description: "redirect_uri does not match the authorization request",
      });
      return;
    }
    if (stored.clientId !== clientIdParam) {
      sendJson(res, 400, {
        error: "invalid_grant",
        error_description: "client_id does not match the authorization request",
      });
      return;
    }

    // Check expiration
    if (Date.now() >= stored.expiresAt) {
      sendJson(res, 400, {
        error: "invalid_grant",
        error_description: "Authorization code has expired",
      });
      return;
    }

    // PKCE S256 verification: base64url(SHA256(code_verifier)) == code_challenge
    const computedChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    if (computedChallenge !== stored.codeChallenge) {
      sendJson(res, 400, {
        error: "invalid_grant",
        error_description: "PKCE code_verifier does not match code_challenge",
      });
      return;
    }

    // Decrypt the API key
    const apiKey = decrypt(stored.encryptedApiKey);

    const expiresIn = TOKEN_TTL_SECONDS;
    const accessToken = generateAccessToken();

    await storeOAuthToken(accessToken, apiKey, expiresIn, stored.userId);

    sendJson(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
    });
  }

  /**
   * Rebuilds a Streamable HTTP session on this replica from its Redis record,
   * for a session first created on another one. Returns null when no record
   * exists or when the record belongs to a different project, and throws when
   * the SDK internals the rebuild depends on have moved.
   *
   * Rebuilding is itself a side effect — it decrypts the stored key, connects
   * a server bound to it and puts the session in this replica's map — so the
   * caller's own key is checked against the record before any of that runs,
   * rather than only checked on the response.
   */
  async function recoverStreamableSession({
    sessionId,
    incomingToken,
    callerApiKey,
  }: {
    sessionId: string;
    incomingToken: string | null;
    callerApiKey: string;
  }): Promise<SessionState | null> {
    const redisApiKey = await getSessionFromRedis(sessionId);
    if (!redisApiKey) return null;
    if (redisApiKey !== callerApiKey) return null;

    // WORKAROUND: The SDK transport starts uninitialized — we patch its
    // inner state so it accepts non-init requests with the existing
    // session ID. This accesses private fields of the SDK's
    // StreamableHTTPServerTransport wrapper and the underlying
    // WebStandardStreamableHTTPServerTransport.
    // Tested against @modelcontextprotocol/sdk@1.29.0.
    // See: https://github.com/modelcontextprotocol/typescript-sdk/issues/1658
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });

    // Runtime assertion: verify the internal structure hasn't changed
    const transportAny = transport as unknown as Record<string, unknown>;
    if (
      !transportAny._webStandardTransport ||
      typeof transportAny._webStandardTransport !== "object"
    ) {
      throw new Error(
        "StreamableHTTPServerTransport internal structure changed — " +
          "Redis session recovery unavailable. Update the SDK workaround.",
      );
    }

    const inner = transportAny._webStandardTransport as Record<string, unknown>;
    inner._initialized = true;
    inner.sessionId = sessionId;

    // Re-resolve to recover OAuth userId if the token still has one;
    // graceful degradation to undefined for direct-apiKey sessions.
    const recoveredCtx = incomingToken
      ? await resolveSessionContext(incomingToken)
      : null;
    const session: SessionState = {
      transport,
      apiKey: redisApiKey,
      userId: recoveredCtx?.userId,
      lastActivityAt: Date.now(),
    };
    sessions.set(sessionId, session);

    transport.onclose = () => {
      sessions.delete(sessionId);
    };

    const sessionServer = createMcpServer();
    sessionTools?.register({
      server: sessionServer,
      apiKey: redisApiKey,
      callerUserId: recoveredCtx?.userId,
    });
    await handleWithSessionConfig(redisApiKey, () => sessionServer.connect(transport));

    return session;
  }

  async function handleMcpPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req, res);
    if (body === undefined) return;

    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    // Extract once at the top — reused on session-recovery path to recover
    // the OAuth-flowing userId (governance tools attribution) and on the
    // existing-session path for Bearer match validation.
    const incomingToken = extractBearerToken(req);

    // Existing session — check local Map first, then Redis
    if (sessionId) {
      let session = sessions.get(sessionId);
      const callerApiKey = incomingToken ? await resolveApiKey(incomingToken) : null;

      // L2: Redis lookup — session may live on another pod. Only a caller
      // that already proved it owns the session gets this far, so naming
      // someone else's session id rebuilds nothing here.
      if (!session && callerApiKey) {
        try {
          session =
            (await recoverStreamableSession({
              sessionId,
              incomingToken,
              callerApiKey,
            })) ?? undefined;
        } catch (err) {
          logger.error({ error: err }, "MCP session recovery failed");
          sendJson(res, 500, { error: "Internal server error" });
          return;
        }
      }

      if (session) {
        if (!incomingToken) {
          send401(res, "Authorization header required");
          return;
        }
        if (callerApiKey !== session.apiKey) {
          send401(res, "Bearer token does not match session");
          return;
        }

        session.lastActivityAt = Date.now();
        touchSessionInRedis(sessionId, session.apiKey).catch(() => {});
        await handleWithSessionConfig(session.apiKey, () =>
          session.transport.handleRequest(req, res, body),
        );
        return;
      }
    }

    // New session — must be an initialize request
    if ((!sessionId || !sessions.has(sessionId)) && isInitializeRequest(body)) {
      // Rate limit failed auth attempts (check only — track on failure in authenticateRequest)
      const ip = getClientIp(req);
      if (authFailRateLimiter.isBlocked(ip)) {
        sendJson(res, 429, { error: "Too many requests" });
        return;
      }

      const apiKey = await authenticateRequest(req, res);
      if (!apiKey) return; // 401 already sent

      // Re-resolve the token to recover the OAuth-flowing userId (if any)
      // for governance MCP tool attribution. authenticateRequest only
      // returns the apiKey, but resolveSessionContext is cheap and the
      // entry was just populated.
      const initialCtx = incomingToken
        ? await resolveSessionContext(incomingToken)
        : null;
      const userId = initialCtx?.userId;

      // Per-key session limit (cross-pod via Redis)
      if ((await sessionCountForKey(apiKey)) >= MAX_SESSIONS_PER_KEY) {
        sendJson(res, 429, {
          error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, {
            transport,
            apiKey,
            userId,
            lastActivityAt: Date.now(),
          });
          storeSessionInRedis(id, apiKey).catch(() => {});
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          removeSessionFromRedis(transport.sessionId, apiKey).catch(() => {});
        }
      };

      const sessionServer = createMcpServer();
      sessionTools?.register({ server: sessionServer, apiKey, callerUserId: userId });
      await handleWithSessionConfig(apiKey, () => sessionServer.connect(transport));

      await handleWithSessionConfig(apiKey, () =>
        transport.handleRequest(req, res, body),
      );
      return;
    }

    // If a session ID was provided but not found, the session expired.
    // Return 401 with WWW-Authenticate so OAuth clients re-authenticate.
    if (sessionId) {
      send401(res, "Session expired or not found");
      return;
    }

    sendJson(res, 400, {
      error: "Invalid request — no session ID or not an initialize request",
    });
  }

  async function handleMcpGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      sendJson(res, 400, { error: "Invalid request — no valid session ID" });
      return;
    }

    let session = sessions.get(sessionId);
    const incomingToken = extractBearerToken(req);
    const callerApiKey = incomingToken ? await resolveApiKey(incomingToken) : null;

    // L2: Redis lookup — the session may have been created on another pod, and
    // reopening the stream is exactly what a client does after a reconnect.
    // The caller's key is resolved first so an unauthenticated reconnect
    // cannot make this replica rebuild a session it was never given.
    if (!session && callerApiKey) {
      try {
        session =
          (await recoverStreamableSession({
            sessionId,
            incomingToken,
            callerApiKey,
          })) ?? undefined;
      } catch (err) {
        logger.error({ error: err }, "MCP session recovery failed");
        sendJson(res, 500, { error: "Internal server error" });
        return;
      }
    }

    if (!session) {
      // A caller that presented nothing is told that, rather than that the
      // session vanished — the two need different things from the client.
      // A caller whose token belongs elsewhere is told the session is gone,
      // which is also the answer that confirms nothing about it.
      send401(
        res,
        incomingToken ? "Session expired or not found" : "Authorization header required",
      );
      return;
    }

    if (!incomingToken) {
      send401(res, "Authorization header required");
      return;
    }
    if (callerApiKey !== session.apiKey) {
      send401(res, "Bearer token does not match session");
      return;
    }

    session.lastActivityAt = Date.now();
    touchSessionInRedis(sessionId, session.apiKey).catch(() => {});
    await handleWithSessionConfig(session.apiKey, () =>
      session.transport.handleRequest(req, res),
    );
  }

  async function handleMcpDelete(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;

      const token = extractBearerToken(req);
      if (!token) {
        send401(res, "Authorization header required");
        return;
      }
      const apiKey = await resolveApiKey(token);
      if (apiKey !== session.apiKey) {
        send401(res, "Bearer token does not match session");
        return;
      }

      await session.transport.close();
      sessions.delete(sessionId);
      removeSessionFromRedis(sessionId, session.apiKey).catch(() => {});
      sendJson(res, 200, { status: "session closed" });
    } else {
      sendJson(res, 404, { error: "Session not found" });
    }
  }

  // -------------------------------------------------------------------------
  // SSE transport handlers (ChatGPT, etc.)
  // -------------------------------------------------------------------------

  /**
   * Listens for messages other replicas hand to this session. The reply
   * travels back down the stream this replica holds, which is why the message
   * comes to the stream rather than the stream moving to the message.
   */
  async function subscribeSessionToRelay({
    sessionId,
    session,
  }: {
    sessionId: string;
    session: SseSessionState;
  }): Promise<void> {
    const subscriber = getRelaySubscriber();
    if (!subscriber) return;

    const channel = relayChannel(sessionId);
    relayListeners.set(channel, (rawMessage) => {
      void deliverRelayedMessage({ sessionId, session, rawMessage });
    });

    try {
      await subscriber.subscribe(channel);
    } catch (err) {
      relayListeners.delete(channel);
      logger.error(
        { error: err, sessionId },
        "Failed to subscribe to the MCP SSE relay channel",
      );
    }
  }

  async function deliverRelayedMessage({
    sessionId,
    session,
    rawMessage,
  }: {
    sessionId: string;
    session: SseSessionState;
    rawMessage: string;
  }): Promise<void> {
    try {
      session.lastActivityAt = Date.now();
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleMessage(JSON.parse(rawMessage)),
      );
      await touchSseSessionInRedis(sessionId, session.apiKey);
    } catch (err) {
      logger.error({ error: err, sessionId }, "Failed to handle relayed MCP SSE message");
    }
  }

  async function handleSseConnect(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const apiKey = await authenticateRequest(req, res);
    if (!apiKey) return;

    const sseToken = extractBearerToken(req);
    const sseCtx = sseToken ? await resolveSessionContext(sseToken) : null;
    const sseUserId = sseCtx?.userId;

    if ((await sessionCountForKey(apiKey)) >= MAX_SESSIONS_PER_KEY) {
      sendJson(res, 429, {
        error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
      });
      return;
    }

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    noteLogFields(res, { sessionId });

    const session: SseSessionState = {
      transport,
      apiKey,
      userId: sseUserId,
      lastActivityAt: Date.now(),
    };
    sseSessions.set(sessionId, session);

    // Published before the stream opens: a client can post its first message
    // to another replica the instant it reads the endpoint event.
    try {
      await storeSseSessionInRedis(sessionId, apiKey);
    } catch (err) {
      logger.error({ error: err }, "Failed to record MCP SSE session in Redis");
    }

    await subscribeSessionToRelay({ sessionId, session });

    const sessionServer = createMcpServer();
    sessionTools?.register({ server: sessionServer, apiKey, callerUserId: sseUserId });

    res.on("close", () => {
      releaseSseSession(sessionId, apiKey).catch(() => {});
    });

    await handleWithSessionConfig(apiKey, () => sessionServer.connect(transport));
  }

  async function handleSseMessage(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "", "http://localhost");
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      sendJson(res, 400, { error: "Invalid or missing session ID" });
      return;
    }
    noteLogFields(res, { sessionId });

    // Authenticate before looking the session up, so a caller with no
    // credentials is told it is unauthorized rather than that its session is
    // bad — the two need different fixes.
    const token = extractBearerToken(req);
    if (!token) {
      send401(res, "Authorization header required");
      return;
    }
    const apiKey = await resolveApiKey(token);
    if (!apiKey) {
      authFailRateLimiter.track(getClientIp(req));
      send401(res, "Invalid or expired token");
      return;
    }

    const localSession = sseSessions.get(sessionId);
    if (localSession) {
      if (apiKey !== localSession.apiKey) {
        send401(res, "Bearer token does not match session");
        return;
      }
      localSession.lastActivityAt = Date.now();
      touchSseSessionInRedis(sessionId, localSession.apiKey).catch(() => {});

      const body = await readJsonBody(req, res);
      if (body === undefined) return;

      await handleWithSessionConfig(localSession.apiKey, () =>
        localSession.transport.handlePostMessage(req, res, body),
      );
      return;
    }

    // The stream lives on another replica. Hand the message over rather than
    // reject it: the load balancer has no session affinity, so most messages
    // of a healthy session arrive on a replica that does not hold it.
    const sessionApiKey = await getSseSessionFromRedis(sessionId);
    if (!sessionApiKey) {
      sendJson(res, 404, { error: "Session not found" });
      return;
    }
    if (apiKey !== sessionApiKey) {
      send401(res, "Bearer token does not match session");
      return;
    }

    const body = await readJsonBody(req, res);
    if (body === undefined) return;

    if (!redis) {
      sendJson(res, 404, { error: "Session not found" });
      return;
    }

    const receivers = await redis.publish(relayChannel(sessionId), JSON.stringify(body));
    if (receivers === 0) {
      // Nobody is listening: the replica that held the stream is gone, and the
      // record outlived it. Clear it so the client reconnects instead of
      // posting into a void.
      await removeSseSessionFromRedis(sessionId, sessionApiKey);
      sendJson(res, 404, { error: "Session not found" });
      return;
    }

    await touchSseSessionInRedis(sessionId, sessionApiKey);
    // The JSON-RPC reply travels down the SSE stream on the replica that holds
    // it, so this response only acknowledges the handoff — the same 202 the
    // SDK's own transport answers a local post with.
    sendJson(res, 202, { status: "accepted" });
  }

  // -------------------------------------------------------------------------
  // Main request dispatcher
  // -------------------------------------------------------------------------

  /**
   * Serves the path-suffixed OAuth discovery documents. Returns true when the
   * request belonged to one of those subtrees and has been answered.
   */
  function serveOAuthMetadataSubtree({
    req,
    res,
    pathname,
    method,
  }: {
    req: IncomingMessage;
    res: ServerResponse;
    pathname: string;
    method: string;
  }): boolean {
    const prefix = OAUTH_METADATA_PREFIXES.find((candidate) =>
      pathname.startsWith(candidate),
    );
    if (!prefix) return false;

    if (method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }

    // The trailing separator of the prefix starts the resource path.
    const resourceSuffix = pathname.slice(prefix.length - 1);
    if (!METADATA_RESOURCE_SUFFIXES.has(resourceSuffix)) {
      handleUnknownMetadata(res);
      return true;
    }

    if (prefix.startsWith(PROTECTED_RESOURCE_METADATA_PATH)) {
      handleProtectedResourceMetadata(req, res, resourceSuffix);
    } else {
      handleOAuthMetadata(req, res);
    }
    return true;
  }

  /**
   * Emits one access log line per MCP request once the response is done.
   * Wrapped throughout: an observability failure must never take a request
   * with it.
   */
  function logRequestOnCompletion({
    req,
    res,
    pathname,
    method,
  }: {
    req: IncomingMessage;
    res: ServerResponse;
    pathname: string;
    method: string;
  }): void {
    try {
      const startedAt = Date.now();
      res.once("close", () => {
        try {
          logger.info(
            {
              method,
              path: pathname,
              status: res.statusCode,
              durationMs: Date.now() - startedAt,
              ...requestLogFields.get(res),
            },
            "MCP request",
          );
        } catch {
          // Logging must not break request handling.
        }
      });
      const headerSessionId = req.headers["mcp-session-id"];
      if (typeof headerSessionId === "string") {
        noteLogFields(res, { sessionId: headerSessionId });
      }
    } catch {
      // Logging must not break request handling.
    }
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "";
    const pathname = url.split("?")[0] ?? "";
    const method = req.method ?? "GET";

    logRequestOnCompletion({ req, res, pathname, method });

    // Set CORS headers on all MCP routes (including error responses)
    setCorsHeaders(res);

    // Handle OPTIONS preflight for any MCP route
    if (method === "OPTIONS" && isMcpRoute(pathname)) {
      res.writeHead(200);
      res.end();
      return;
    }

    // Dispatch to route handlers
    const handle = async () => {
      // RFC 9728 path-suffixed discovery, tried before the bare form by every
      // current MCP client.
      if (serveOAuthMetadataSubtree({ req, res, pathname, method })) return;

      switch (pathname) {
        case "/mcp/health":
          handleHealthCheck(req, res);
          break;
        case PROTECTED_RESOURCE_METADATA_PATH:
          if (method === "GET") {
            handleProtectedResourceMetadata(req, res);
          } else {
            sendJson(res, 405, { error: "Method not allowed" });
          }
          break;
        case AUTHORIZATION_SERVER_METADATA_PATH:
          if (method === "GET") {
            handleOAuthMetadata(req, res);
          } else {
            sendJson(res, 405, { error: "Method not allowed" });
          }
          break;
        case "/.well-known/openid-configuration":
          // Not an OpenID provider. Claimed anyway so the probe gets a JSON
          // 404 rather than the single-page app.
          handleUnknownMetadata(res);
          break;
        case "/oauth/register":
          if (method === "POST") {
            await handleOAuthRegister(req, res);
          } else {
            sendJson(res, 405, { error: "Method not allowed" });
          }
          break;
        case "/oauth/token":
          if (method === "POST") {
            await handleOAuthToken(req, res);
          } else {
            sendJson(res, 405, { error: "Method not allowed" });
          }
          break;
        case "/mcp":
          switch (method) {
            case "POST":
              await handleMcpPost(req, res);
              break;
            case "GET":
              await handleMcpGet(req, res);
              break;
            case "DELETE":
              await handleMcpDelete(req, res);
              break;
            default:
              sendJson(res, 405, { error: "Method not allowed" });
          }
          break;
        case "/sse":
          if (method === "GET") {
            await handleSseConnect(req, res);
          } else {
            sendJson(res, 405, { error: "Method not allowed" });
          }
          break;
        case "/messages":
        case "/sse/messages":
          if (method === "POST") {
            await handleSseMessage(req, res);
          } else {
            sendJson(res, 405, { error: "Method not allowed" });
          }
          break;
        default:
          sendJson(res, 404, { error: "Not found" });
      }
    };

    handle().catch((err) => {
      logger.error({ error: err, url: req.url }, "MCP handler error");
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  function clearTokenCache(): void {
    oauthTokens.clear();
  }

  function clearRateLimiters(): void {
    registerRateLimiter.clear();
    tokenRateLimiter.clear();
    authFailRateLimiter.clear();
  }

  /**
   * Resolves once every session record this replica owns is gone from Redis.
   * Shutdown waits on it: a released record frees a slot against the
   * per-project concurrent-session limit, and a process that exits without
   * waiting leaves those slots allocated until their TTL.
   */
  async function closeAllSessions(): Promise<void> {
    clearInterval(reaper);
    for (const [id, session] of sessions) {
      session.transport.close().catch(() => {});
      sessions.delete(id);
    }
    const released: Promise<void>[] = [];
    for (const [id, session] of sseSessions) {
      session.transport.close().catch(() => {});
      released.push(releaseSseSession(id, session.apiKey).catch(() => {}));
    }
    await Promise.all(released);
    relayListeners.clear();
    if (relaySubscriber) {
      relaySubscriber.disconnect();
      relaySubscriber = null;
    }
  }

  return {
    handleRequest,
    isMcpRoute,
    clearTokenCache,
    clearRateLimiters,
    closeAllSessions,
  };
}
