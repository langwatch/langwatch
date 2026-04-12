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
 * - GET  /.well-known/oauth-authorization-server — OAuth metadata
 * - POST /oauth/token  — OAuth token endpoint
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createMcpServer } from "@langwatch/mcp-server/create-mcp-server";
import { getConfig, initConfig, runWithConfig } from "@langwatch/mcp-server/config";
import { prisma } from "../server/db";
import { connection as redis } from "../server/redis";
import { encrypt, decrypt } from "../utils/encryption";
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:mcp");

/** Redis key prefix for OAuth tokens. */
const REDIS_TOKEN_PREFIX = "mcp:oauth:token:";

/** Redis key prefix for MCP authorization codes. */
const REDIS_AUTH_CODE_PREFIX = "mcp:auth_code:";

/** Redis key prefix for MCP transport sessions. */
const REDIS_SESSION_PREFIX = "mcp:session:";

/** Redis key for the set of session IDs belonging to an API key. */
const REDIS_SESSION_SET_PREFIX = "mcp:sessions_by_key:";

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
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-session state for Streamable HTTP transport. */
interface SessionState {
  transport: StreamableHTTPServerTransport;
  apiKey: string;
  lastActivityAt: number;
}

/** Per-session state for SSE transport. */
interface SseSessionState {
  transport: SSEServerTransport;
  apiKey: string;
  lastActivityAt: number;
}

/** OAuth token entry stored in memory and Redis. */
interface OAuthTokenEntry {
  apiKey: string;
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
  /** Close all active sessions (for graceful shutdown). */
  closeAllSessions: () => void;
}

/**
 * Creates an MCP handler instance that manages sessions, OAuth tokens,
 * and routes for the Streamable HTTP transport.
 */
export function createMcpHandler(): McpHandler {
  // Ensure the MCP config is initialized with the app's endpoint
  try {
    getConfig();
  } catch {
    initConfig({
      endpoint: process.env.BASE_HOST ?? "https://app.langwatch.ai",
    });
  }

  // Use Map to avoid prototype pollution — sessionId comes from user input
  const sessions = new Map<string, SessionState>();
  const sseSessions = new Map<string, SseSessionState>();
  const oauthTokens = new Map<string, OAuthTokenEntry>();

  // Rate limiters
  const oauthRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
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
  const SESSION_REDIS_TTL_SECONDS = 35 * 60; // 35 minutes (slightly longer than local, buffer for clock skew)
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

    // Sweep idle SSE sessions (SSE is connection-bound, no Redis needed)
    for (const [id, session] of sseSessions) {
      if (now - session.lastActivityAt > SESSION_MAX_AGE_MS) {
        session.transport.close().catch(() => {});
        sseSessions.delete(id);
      }
    }

    // Sweep expired in-memory OAuth token cache (Redis is source of truth)
    for (const [token, entry] of oauthTokens) {
      if (now >= entry.expiresAt) {
        oauthTokens.delete(token);
      }
    }

    // Sweep expired rate limiter entries
    oauthRateLimiter.sweep();
    authFailRateLimiter.sweep();
  }, REAPER_INTERVAL_MS);

  // Allow the process to exit naturally even if the reaper is still scheduled
  reaper.unref();

  // -------------------------------------------------------------------------
  // Route matching
  // -------------------------------------------------------------------------

  const MCP_ROUTES = new Set([
    "/mcp",
    "/mcp/health",
    "/sse",
    "/messages",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
    "/oauth/token",
    "/oauth/register",
  ]);

  function isMcpRoute(pathname: string): boolean {
    return MCP_ROUTES.has(pathname);
  }

  // -------------------------------------------------------------------------
  // CORS — Access-Control-Allow-Origin: * is intentional; the Bearer token
  // provides the security boundary, not the origin.
  // -------------------------------------------------------------------------

  function setCorsHeaders(res: ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, MCP-Protocol-Version",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  }

  // -------------------------------------------------------------------------
  // JSON helpers
  // -------------------------------------------------------------------------

  function sendJson(
    res: ServerResponse,
    statusCode: number,
    data: unknown,
  ): void {
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

  function parseFormBody(raw: string): Record<string, string> {
    const params = new URLSearchParams(raw);
    const result: Record<string, string> = {};
    for (const [key, value] of params) {
      result[key] = value;
    }
    return result;
  }

  function getClientIp(req: IncomingMessage): string {
    // Use socket address only — X-Forwarded-For is client-controlled and
    // would let attackers bypass rate limits by spoofing different IPs.
    // Behind a reverse proxy (K8s, Cloudflare), the socket address is the
    // proxy's IP, which means rate limiting is per-proxy not per-client.
    // This is acceptable: the proxy itself limits concurrent connections.
    return req.socket.remoteAddress ?? "unknown";
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
   * Resolves a Bearer token to an API key.
   * Checks in-memory OAuth tokens first, then Redis (encrypted), and falls
   * back to treating the token as a direct API key.
   */
  async function resolveApiKey(token: string): Promise<string | null> {
    // 1. Check in-memory OAuth token cache
    const memEntry = oauthTokens.get(token);
    if (memEntry) {
      if (Date.now() < memEntry.expiresAt) {
        return memEntry.apiKey;
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
            expiresAt: number;
          };
          if (Date.now() < stored.expiresAt) {
            const apiKey = decrypt(stored.encryptedApiKey);
            // Re-populate in-memory cache
            oauthTokens.set(token, { apiKey, expiresAt: stored.expiresAt });
            return apiKey;
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
    //    either the in-memory cache or Redis)
    return token;
  }

  /**
   * Validates an API key against the database.
   * Returns the project if valid, null otherwise.
   */
  async function validateApiKey(
    apiKey: string,
  ): Promise<{ id: string; teamId: string } | null> {
    try {
      const project = await prisma.project.findUnique({
        where: { apiKey, archivedAt: null },
      });
      return project;
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
    const baseUrl =
      process.env.BASE_HOST ?? "https://app.langwatch.ai";
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
  ): Promise<void> {
    const entry: OAuthTokenEntry = {
      apiKey,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    // Store in memory (plaintext — process-local, not persisted)
    oauthTokens.set(accessToken, entry);

    // Store in Redis with encrypted API key
    if (redis) {
      try {
        const redisEntry = JSON.stringify({
          encryptedApiKey: encrypt(apiKey),
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
  async function storeSessionInRedis(
    sessionId: string,
    apiKey: string,
  ): Promise<void> {
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
  async function touchSessionInRedis(
    sessionId: string,
    apiKey: string,
  ): Promise<void> {
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
  async function getSessionFromRedis(
    sessionId: string,
  ): Promise<string | null> {
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
      // Count Streamable HTTP sessions from Redis (cross-pod)
      const members = await redis.smembers(
        `${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`,
      );
      let liveCount = 0;
      for (const id of members) {
        const exists = await redis.exists(`${REDIS_SESSION_PREFIX}${id}`);
        if (exists) {
          liveCount++;
        } else {
          // Stale entry — session expired, clean it from the set
          await redis.srem(`${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`, id);
        }
      }
      // SSE sessions are connection-bound (not in Redis) — count local only
      for (const session of sseSessions.values()) {
        if (session.apiKey === apiKey) liveCount++;
      }
      return liveCount;
    } catch (err) {
      logger.error({ error: err }, "Redis session count failed");
      return 0; // Fail open to avoid blocking users
    }
  }

  // -------------------------------------------------------------------------
  // Route handlers
  // -------------------------------------------------------------------------

  function handleHealthCheck(_req: IncomingMessage, res: ServerResponse): void {
    sendJson(res, 200, { status: "ok" });
  }

  function handleProtectedResourceMetadata(
    _req: IncomingMessage,
    res: ServerResponse,
  ): void {
    const baseUrl =
      process.env.BASE_HOST ?? "https://app.langwatch.ai";

    sendJson(res, 200, {
      resource: baseUrl,
      authorization_servers: [baseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp:tools"],
    });
  }

  function handleOAuthMetadata(
    _req: IncomingMessage,
    res: ServerResponse,
  ): void {
    // Use configured endpoint to prevent host header injection
    const baseUrl =
      process.env.BASE_HOST ?? "https://app.langwatch.ai";

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
    if (oauthRateLimiter.isBlocked(ip)) {
      sendJson(res, 429, { error: "Too many requests" });
      return;
    }
    oauthRateLimiter.track(ip);

    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === "Request body too large") {
        sendJson(res, 413, { error: "Request body too large" });
        return;
      }
      throw err;
    }

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
    // OAuth flow, so any registration succeeds. The real authorization
    // happens at the consent page where the user picks a project.
    const clientId = `mcp_${randomUUID().replace(/-/g, "")}`;

    sendJson(res, 201, {
      client_id: clientId,
      client_name: body.client_name ?? "MCP Client",
      redirect_uris: body.redirect_uris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  }

  async function handleOAuthToken(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // Rate limit token endpoint per IP
    const ip = getClientIp(req);
    if (oauthRateLimiter.isBlocked(ip)) {
      sendJson(res, 429, { error: "Too many requests" });
      return;
    }
    oauthRateLimiter.track(ip);

    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === "Request body too large") {
        sendJson(res, 413, { error: "Request body too large" });
        return;
      }
      throw err;
    }
    const params = parseFormBody(raw);

    if (params.grant_type !== "authorization_code") {
      sendJson(res, 400, {
        error: "unsupported_grant_type",
        error_description:
          "Only authorization_code grant type is supported",
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
      codeChallenge: string;
      codeChallengeMethod: string;
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

    await storeOAuthToken(accessToken, apiKey, expiresIn);

    sendJson(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
    });
  }

  async function handleMcpPost(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === "Request body too large") {
        sendJson(res, 413, { error: "Request body too large" });
        return;
      }
      throw err;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Existing session — check local Map first, then Redis
    if (sessionId) {
      let session = sessions.get(sessionId);

      // L2: Redis lookup — session may live on another pod
      if (!session) {
        const redisApiKey = await getSessionFromRedis(sessionId);
        if (redisApiKey) {
          // Recreate transport locally for this pod.
          // WORKAROUND: The SDK transport starts uninitialized — we patch its
          // inner state so it accepts non-init requests with the existing
          // session ID. This accesses private fields of the SDK's
          // StreamableHTTPServerTransport wrapper and the underlying
          // WebStandardStreamableHTTPServerTransport.
          // Tested against @modelcontextprotocol/sdk@1.26.0.
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
            logger.error(
              "StreamableHTTPServerTransport internal structure changed — " +
                "Redis session recovery unavailable. Update the SDK workaround.",
            );
            sendJson(res, 500, { error: "Internal server error" });
            return;
          }

          const inner = transportAny._webStandardTransport as Record<
            string,
            unknown
          >;
          inner._initialized = true;
          inner.sessionId = sessionId;

          session = {
            transport,
            apiKey: redisApiKey,
            lastActivityAt: Date.now(),
          };
          sessions.set(sessionId, session);

          transport.onclose = () => {
            sessions.delete(sessionId);
          };

          const sessionServer = createMcpServer();
          await handleWithSessionConfig(redisApiKey, () =>
            sessionServer.connect(transport),
          );
        }
      }

      if (session) {
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
          sessions.set(id, { transport, apiKey, lastActivityAt: Date.now() });
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
      await handleWithSessionConfig(apiKey, () =>
        sessionServer.connect(transport),
      );

      await handleWithSessionConfig(apiKey, () =>
        transport.handleRequest(req, res, body),
      );
      return;
    }

    sendJson(res, 400, {
      error: "Invalid request — no session ID or not an initialize request",
    });
  }

  async function handleMcpGet(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (sessionId && session) {
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

      session.lastActivityAt = Date.now();
      touchSessionInRedis(sessionId, session.apiKey).catch(() => {});
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleRequest(req, res),
      );
    } else {
      sendJson(res, 400, { error: "Invalid request — no valid session ID" });
    }
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

  async function handleSseConnect(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const apiKey = await authenticateRequest(req, res);
    if (!apiKey) return;

    if ((await sessionCountForKey(apiKey)) >= MAX_SESSIONS_PER_KEY) {
      sendJson(res, 429, {
        error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
      });
      return;
    }

    const transport = new SSEServerTransport("/messages", res);
    sseSessions.set(transport.sessionId, {
      transport,
      apiKey,
      lastActivityAt: Date.now(),
    });

    const sessionServer = createMcpServer();

    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
    });

    await handleWithSessionConfig(apiKey, () =>
      sessionServer.connect(transport),
    );
  }

  async function handleSseMessage(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "", "http://localhost");
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId || !sseSessions.has(sessionId)) {
      sendJson(res, 400, { error: "Invalid or missing session ID" });
      return;
    }

    const session = sseSessions.get(sessionId)!;

    // Re-authenticate: verify Bearer token matches the session
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

    session.lastActivityAt = Date.now();

    let raw: string;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (err instanceof Error && err.message === "Request body too large") {
        sendJson(res, 413, { error: "Request body too large" });
        return;
      }
      throw err;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    await handleWithSessionConfig(session.apiKey, () =>
      session.transport.handlePostMessage(req, res, body),
    );
  }

  // -------------------------------------------------------------------------
  // Main request dispatcher
  // -------------------------------------------------------------------------

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? "";
    const pathname = url.split("?")[0] ?? "";
    const method = req.method ?? "GET";

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
      switch (pathname) {
        case "/mcp/health":
          handleHealthCheck(req, res);
          break;
        case "/.well-known/oauth-protected-resource":
          if (method === "GET") {
            handleProtectedResourceMetadata(req, res);
          } else {
            sendJson(res, 405, { error: "Method not allowed" });
          }
          break;
        case "/.well-known/oauth-authorization-server":
          if (method === "GET") {
            handleOAuthMetadata(req, res);
          } else {
            sendJson(res, 405, { error: "Method not allowed" });
          }
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

  function closeAllSessions(): void {
    clearInterval(reaper);
    for (const [id, session] of sessions) {
      session.transport.close().catch(() => {});
      sessions.delete(id);
    }
    for (const [id, session] of sseSessions) {
      session.transport.close().catch(() => {});
      sseSessions.delete(id);
    }
  }

  return {
    handleRequest,
    isMcpRoute,
    clearTokenCache,
    closeAllSessions,
  };
}
