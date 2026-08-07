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

// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getConfig,
  initConfig,
  runWithConfig,
} from "@langwatch/mcp-server/config";
import { createMcpServer } from "@langwatch/mcp-server/create-mcp-server";
import { createLogger } from "@langwatch/observability";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { prisma } from "../server/db";
import { connection as redis } from "../server/redis";
import { decrypt, encrypt } from "../utils/encryption";
import { registerGovernanceMcpTools } from "./governance-tools";
import { registerOAuthClient } from "./oauthClientRegistry";

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
    /** Drop every tracked entry (for testing). */
    clear() {
      entries.clear();
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

type RateLimiter = ReturnType<typeof createRateLimiter>;

/** Per-handler mutable state, threaded through the module-scope helpers. */
interface McpHandlerState {
  sessions: Map<string, SessionState>;
  sseSessions: Map<string, SseSessionState>;
  oauthTokens: Map<string, OAuthTokenEntry>;
  oauthRateLimiter: RateLimiter;
  authFailRateLimiter: RateLimiter;
}

/** What a Bearer token resolves to: a project apiKey plus the OAuth user, if any. */
interface SessionContext {
  apiKey: string;
  userId?: string;
}

/** Everything a route handler needs to answer one request. */
interface RouteContext {
  state: McpHandlerState;
  req: IncomingMessage;
  res: ServerResponse;
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
  /** Close all active sessions (for graceful shutdown). */
  closeAllSessions: () => void;
}

// ---------------------------------------------------------------------------
// Session & token reaper — prevents unbounded memory from abandoned sessions
// and never-used OAuth tokens.
// ---------------------------------------------------------------------------

const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes (local transport cleanup)
const SESSION_REDIS_TTL_SECONDS = TOKEN_TTL_SECONDS; // Match OAuth token TTL (30 days) — session metadata is tiny, no reason to expire it sooner
const REAPER_INTERVAL_MS = 60 * 1000; // 60 seconds

// Sweep idle local transports (Redis entries expire via TTL)
function sweepIdleSessions(state: McpHandlerState, now: number): void {
  for (const [id, session] of state.sessions) {
    if (now - session.lastActivityAt > SESSION_MAX_AGE_MS) {
      session.transport.close().catch(() => {});
      state.sessions.delete(id);
      removeSessionFromRedis(id, session.apiKey).catch(() => {});
    }
  }
}

// Sweep idle SSE sessions (SSE is connection-bound, no Redis needed)
function sweepIdleSseSessions(state: McpHandlerState, now: number): void {
  for (const [id, session] of state.sseSessions) {
    if (now - session.lastActivityAt > SESSION_MAX_AGE_MS) {
      session.transport.close().catch(() => {});
      state.sseSessions.delete(id);
    }
  }
}

// Sweep expired in-memory OAuth token cache (Redis is source of truth)
function sweepExpiredTokens(state: McpHandlerState, now: number): void {
  for (const [token, entry] of state.oauthTokens) {
    if (now >= entry.expiresAt) {
      state.oauthTokens.delete(token);
    }
  }
}

function reapExpiredState(state: McpHandlerState): void {
  const now = Date.now();

  sweepIdleSessions(state, now);
  sweepIdleSseSessions(state, now);
  sweepExpiredTokens(state, now);

  // Sweep expired rate limiter entries
  state.oauthRateLimiter.sweep();
  state.authFailRateLimiter.sweep();
}

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CORS — Access-Control-Allow-Origin: * is intentional; the Bearer token
// provides the security boundary, not the origin.
// ---------------------------------------------------------------------------

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, mcp-session-id, MCP-Protocol-Version",
  );
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

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

/**
 * Read the request body, answering 413 and returning null when it exceeds
 * MAX_BODY_BYTES. Any other read failure propagates to the dispatcher.
 */
async function readBodyOrSend413({
  req,
  res,
}: {
  req: IncomingMessage;
  res: ServerResponse;
}): Promise<string | null> {
  try {
    return await readBody(req);
  } catch (err) {
    if (err instanceof Error && err.message === "Request body too large") {
      sendJson(res, 413, { error: "Request body too large" });
      return null;
    }
    throw err;
  }
}

/** Parse a JSON body, answering 400 and returning null when it is malformed. */
function parseJsonBodyOrSend400({
  res,
  raw,
}: {
  res: ServerResponse;
  raw: string;
}): { body: unknown } | null {
  try {
    return { body: JSON.parse(raw) };
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return null;
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

function getClientIp(req: IncomingMessage): string {
  // Use socket address only — X-Forwarded-For is client-controlled and
  // would let attackers bypass rate limits by spoofing different IPs.
  // Behind a reverse proxy (K8s, Cloudflare), the socket address is the
  // proxy's IP, which means rate limiting is per-proxy not per-client.
  // This is acceptable: the proxy itself limits concurrent connections.
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * Rate limit an OAuth endpoint per IP. Answers 429 and returns true when the
 * caller is over the limit; records the request and returns false otherwise.
 */
function throttleOAuthRequest({ state, req, res }: RouteContext): boolean {
  const ip = getClientIp(req);
  if (state.oauthRateLimiter.isBlocked(ip)) {
    sendJson(res, 429, { error: "Too many requests" });
    return true;
  }
  state.oauthRateLimiter.track(ip);
  return false;
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

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
async function resolveApiKey({
  state,
  token,
}: {
  state: McpHandlerState;
  token: string;
}): Promise<string | null> {
  const ctx = await resolveSessionContext({ state, token });
  return ctx?.apiKey ?? null;
}

/**
 * Outcome of one token store lookup: a usable context, a token that is present
 * but no longer valid, or no entry at all (try the next store).
 */
type TokenLookup =
  | { outcome: "resolved"; context: SessionContext }
  | { outcome: "rejected" }
  | { outcome: "absent" };

function lookupTokenInMemory({
  state,
  token,
}: {
  state: McpHandlerState;
  token: string;
}): TokenLookup {
  const memEntry = state.oauthTokens.get(token);
  if (!memEntry) return { outcome: "absent" };
  if (Date.now() < memEntry.expiresAt) {
    return {
      outcome: "resolved",
      context: { apiKey: memEntry.apiKey, userId: memEntry.userId },
    };
  }
  state.oauthTokens.delete(token);
  return { outcome: "rejected" };
}

// The API key is encrypted at rest in Redis.
async function lookupTokenInRedis({
  state,
  token,
}: {
  state: McpHandlerState;
  token: string;
}): Promise<TokenLookup> {
  if (!redis) return { outcome: "absent" };
  try {
    const redisData = await redis.get(`${REDIS_TOKEN_PREFIX}${token}`);
    if (!redisData) return { outcome: "absent" };
    const stored = JSON.parse(redisData) as {
      encryptedApiKey: string;
      userId?: string;
      expiresAt: number;
    };
    if (Date.now() < stored.expiresAt) {
      const apiKey = decrypt(stored.encryptedApiKey);
      // Re-populate in-memory cache
      state.oauthTokens.set(token, {
        apiKey,
        userId: stored.userId,
        expiresAt: stored.expiresAt,
      });
      return {
        outcome: "resolved",
        context: { apiKey, userId: stored.userId },
      };
    }
    await redis.del(`${REDIS_TOKEN_PREFIX}${token}`);
    return { outcome: "rejected" };
  } catch (err) {
    // Redis is down — fall through to treat token as a direct API key.
    // This is safe because validateApiKey() will still check the key
    // against the database, rejecting any invalid tokens.
    logger.error({ error: err }, "Redis token lookup failed");
    return { outcome: "absent" };
  }
}

/**
 * Resolves a Bearer token to {apiKey, userId?}. The userId is set when
 * the token was minted via the /mcp/authorize OAuth flow (we capture
 * `session.user.id` at code creation), and undefined when the token is
 * a direct project apiKey passed as Bearer. Governance MCP tools that
 * need a caller identity (audit attribution, RBAC) read userId from
 * here; tools that only need org context can ignore it.
 */
async function resolveSessionContext({
  state,
  token,
}: {
  state: McpHandlerState;
  token: string;
}): Promise<SessionContext | null> {
  // 1. Check in-memory OAuth token cache
  const cached = lookupTokenInMemory({ state, token });
  if (cached.outcome === "resolved") return cached.context;
  if (cached.outcome === "rejected") return null;

  // 2. Check Redis for OAuth token
  const stored = await lookupTokenInRedis({ state, token });
  if (stored.outcome === "resolved") return stored.context;
  if (stored.outcome === "rejected") return null;

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
  const baseUrl = process.env.BASE_HOST ?? "https://app.langwatch.ai";
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
  );
  sendJson(res, 401, { error });
}

async function authenticateRequest({
  state,
  req,
  res,
}: RouteContext): Promise<string | null> {
  const token = extractBearerToken(req);
  if (!token) {
    send401(res, "Authorization required");
    return null;
  }

  const apiKey = await resolveApiKey({ state, token });
  if (!apiKey) {
    state.authFailRateLimiter.track(getClientIp(req));
    send401(res, "Invalid or expired token");
    return null;
  }

  const project = await validateApiKey(apiKey);
  if (!project) {
    state.authFailRateLimiter.track(getClientIp(req));
    send401(res, "Invalid API key");
    return null;
  }

  return apiKey;
}

/**
 * Verify the Bearer token on this request resolves to the session's apiKey.
 * Sends a 401 and returns false when it does not.
 */
async function verifySessionBearer({
  state,
  req,
  res,
  session,
}: RouteContext & { session: { apiKey: string } }): Promise<boolean> {
  const token = extractBearerToken(req);
  if (!token) {
    send401(res, "Authorization header required");
    return false;
  }
  const apiKey = await resolveApiKey({ state, token });
  if (apiKey !== session.apiKey) {
    send401(res, "Bearer token does not match session");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// runWithConfig wrapper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// OAuth token generation
// ---------------------------------------------------------------------------

function generateAccessToken(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

async function storeOAuthToken({
  state,
  accessToken,
  apiKey,
  expiresIn,
  userId,
}: {
  state: McpHandlerState;
  accessToken: string;
  apiKey: string;
  expiresIn: number;
  userId?: string;
}): Promise<void> {
  const entry: OAuthTokenEntry = {
    apiKey,
    userId,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  // Store in memory (plaintext — process-local, not persisted)
  state.oauthTokens.set(accessToken, entry);

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

// ---------------------------------------------------------------------------
// Redis session helpers
// ---------------------------------------------------------------------------

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
    await redis.sadd(
      `${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`,
      sessionId,
    );
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
    await redis.srem(
      `${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`,
      sessionId,
    );
  } catch {
    // Best-effort cleanup
  }
}

/** Count this pod's Streamable HTTP and SSE sessions for an API key. */
function countLocalSessions({
  state,
  apiKey,
}: {
  state: McpHandlerState;
  apiKey: string;
}): number {
  let count = 0;
  for (const session of state.sessions.values()) {
    if (session.apiKey === apiKey) count++;
  }
  for (const session of state.sseSessions.values()) {
    if (session.apiKey === apiKey) count++;
  }
  return count;
}

/** SSE sessions are connection-bound (not in Redis) — count local only. */
function countLocalSseSessions({
  state,
  apiKey,
}: {
  state: McpHandlerState;
  apiKey: string;
}): number {
  let count = 0;
  for (const session of state.sseSessions.values()) {
    if (session.apiKey === apiKey) count++;
  }
  return count;
}

/** Count Streamable HTTP sessions from Redis (cross-pod), pruning stale ids. */
async function countRedisSessions({
  client,
  apiKey,
}: {
  client: NonNullable<typeof redis>;
  apiKey: string;
}): Promise<number> {
  const members = await client.smembers(
    `${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`,
  );
  let liveCount = 0;
  for (const id of members) {
    const exists = await client.exists(`${REDIS_SESSION_PREFIX}${id}`);
    if (exists) {
      liveCount++;
    } else {
      // Stale entry — session expired, clean it from the set
      await client.srem(`${REDIS_SESSION_SET_PREFIX}${hashApiKey(apiKey)}`, id);
    }
  }
  return liveCount;
}

/** Count sessions for an API key across all pods via Redis. */
async function sessionCountForKey({
  state,
  apiKey,
}: {
  state: McpHandlerState;
  apiKey: string;
}): Promise<number> {
  // Fallback to local count if Redis is down
  if (!redis) return countLocalSessions({ state, apiKey });
  try {
    const liveCount = await countRedisSessions({ client: redis, apiKey });
    return liveCount + countLocalSseSessions({ state, apiKey });
  } catch (err) {
    logger.error({ error: err }, "Redis session count failed");
    return 0; // Fail open to avoid blocking users
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleHealthCheck({ res }: RouteContext): void {
  sendJson(res, 200, { status: "ok" });
}

function handleProtectedResourceMetadata({ res }: RouteContext): void {
  const baseUrl = process.env.BASE_HOST ?? "https://app.langwatch.ai";

  sendJson(res, 200, {
    resource: baseUrl,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp:tools"],
  });
}

function handleOAuthMetadata({ res }: RouteContext): void {
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

/**
 * Read the RFC 7591 client metadata off a registration request. Answers the
 * 400 itself and returns null when the payload is unusable.
 */
function parseClientMetadata({
  res,
  raw,
}: {
  res: ServerResponse;
  raw: string;
}): { redirectUris: string[]; clientName: string } | null {
  let body: {
    redirect_uris?: string[];
    client_name?: string;
    [key: string]: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: "invalid_client_metadata" });
    return null;
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
    return null;
  }

  return {
    redirectUris: body.redirect_uris,
    clientName:
      typeof body.client_name === "string" ? body.client_name : "MCP Client",
  };
}

async function handleOAuthRegister({
  state,
  req,
  res,
}: RouteContext): Promise<void> {
  if (throttleOAuthRequest({ state, req, res })) return;

  const raw = await readBodyOrSend413({ req, res });
  if (raw === null) return;

  const metadata = parseClientMetadata({ res, raw });
  if (!metadata) return;

  // Generate a client_id — we don't restrict which clients can use the
  // OAuth flow, so any registration succeeds. What DOES matter is binding
  // this client_id to the redirect_uris it registered with, so /mcp/authorize
  // can reject a request that later shows up with a different one.
  const clientId = `mcp_${randomUUID().replace(/-/g, "")}`;

  try {
    await registerOAuthClient({
      clientId,
      client: {
        redirectUris: metadata.redirectUris,
        clientName: metadata.clientName,
      },
    });
  } catch (err) {
    logger.error({ error: err }, "Failed to persist OAuth client registration");
    sendJson(res, 500, { error: "server_error" });
    return;
  }

  sendJson(res, 201, {
    client_id: clientId,
    client_name: metadata.clientName,
    redirect_uris: metadata.redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

/** The authorization code record /mcp/authorize wrote to Redis. */
interface StoredAuthCode {
  projectId: string;
  encryptedApiKey: string;
  userId?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}

/** The token-request parameters an authorization_code exchange must carry. */
interface TokenRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}

/**
 * Validate the form parameters of a token request. Answers the 400 itself and
 * returns null when a required parameter is missing or the grant is unsupported.
 */
function validateTokenRequest({
  res,
  params,
}: {
  res: ServerResponse;
  params: Record<string, string>;
}): TokenRequest | null {
  if (params.grant_type !== "authorization_code") {
    sendJson(res, 400, {
      error: "unsupported_grant_type",
      error_description: "Only authorization_code grant type is supported",
    });
    return null;
  }

  const code = params.code;
  if (!code) {
    sendJson(res, 400, {
      error: "invalid_request",
      error_description: "code is required",
    });
    return null;
  }

  const codeVerifier = params.code_verifier;
  if (!codeVerifier) {
    sendJson(res, 400, {
      error: "invalid_request",
      error_description: "code_verifier is required",
    });
    return null;
  }

  // RFC 6749 §4.1.3: redirect_uri MUST be present here and MUST be
  // identical to the one used at the authorization request. §3.2.1: a
  // public client (this one — token_endpoint_auth_method "none") MUST
  // include client_id. Both are re-checked against what /mcp/authorize
  // bound to the code below, once it's decoded.
  const redirectUri = params.redirect_uri;
  if (!redirectUri) {
    sendJson(res, 400, {
      error: "invalid_request",
      error_description: "redirect_uri is required",
    });
    return null;
  }
  const clientId = params.client_id;
  if (!clientId) {
    sendJson(res, 400, {
      error: "invalid_request",
      error_description: "client_id is required",
    });
    return null;
  }

  return { code, codeVerifier, redirectUri, clientId };
}

/**
 * Fetch the authorization code record from Redis and burn it (one-time use).
 * Answers the 500/400 itself and returns null when it cannot be redeemed.
 */
async function takeAuthCode({
  client,
  res,
  code,
}: {
  client: NonNullable<typeof redis>;
  res: ServerResponse;
  code: string;
}): Promise<string | null> {
  const redisKey = `${REDIS_AUTH_CODE_PREFIX}${code}`;
  let authCodeData: string | null;
  try {
    authCodeData = await client.get(redisKey);
  } catch (err) {
    logger.error({ error: err }, "Redis auth code lookup failed");
    sendJson(res, 500, { error: "server_error" });
    return null;
  }

  if (!authCodeData) {
    sendJson(res, 400, {
      error: "invalid_grant",
      error_description: "Invalid or expired authorization code",
    });
    return null;
  }

  // Delete the code immediately (one-time use)
  await client.del(redisKey).catch((err: unknown) => {
    logger.error({ error: err }, "Failed to delete auth code from Redis");
  });

  return authCodeData;
}

function parseStoredAuthCode({
  res,
  authCodeData,
}: {
  res: ServerResponse;
  authCodeData: string;
}): StoredAuthCode | null {
  try {
    return JSON.parse(authCodeData) as StoredAuthCode;
  } catch {
    sendJson(res, 400, {
      error: "invalid_grant",
      error_description: "Corrupted authorization code",
    });
    return null;
  }
}

/**
 * Bind the exchange to the exact client_id + redirect_uri /mcp/authorize
 * validated and recorded for this code — a code minted for one client's
 * registered URI must never be redeemable against a different one — then
 * check expiry and the PKCE challenge. Answers the 400 itself on any mismatch.
 */
function verifyAuthCode({
  res,
  stored,
  request,
}: {
  res: ServerResponse;
  stored: StoredAuthCode;
  request: TokenRequest;
}): boolean {
  if (stored.redirectUri !== request.redirectUri) {
    sendJson(res, 400, {
      error: "invalid_grant",
      error_description:
        "redirect_uri does not match the authorization request",
    });
    return false;
  }
  if (stored.clientId !== request.clientId) {
    sendJson(res, 400, {
      error: "invalid_grant",
      error_description: "client_id does not match the authorization request",
    });
    return false;
  }

  // Check expiration
  if (Date.now() >= stored.expiresAt) {
    sendJson(res, 400, {
      error: "invalid_grant",
      error_description: "Authorization code has expired",
    });
    return false;
  }

  // PKCE S256 verification: base64url(SHA256(code_verifier)) == code_challenge
  const computedChallenge = createHash("sha256")
    .update(request.codeVerifier)
    .digest("base64url");

  if (computedChallenge !== stored.codeChallenge) {
    sendJson(res, 400, {
      error: "invalid_grant",
      error_description: "PKCE code_verifier does not match code_challenge",
    });
    return false;
  }

  return true;
}

async function issueAccessToken({
  state,
  res,
  stored,
}: {
  state: McpHandlerState;
  res: ServerResponse;
  stored: StoredAuthCode;
}): Promise<void> {
  // Decrypt the API key
  const apiKey = decrypt(stored.encryptedApiKey);

  const expiresIn = TOKEN_TTL_SECONDS;
  const accessToken = generateAccessToken();

  await storeOAuthToken({
    state,
    accessToken,
    apiKey,
    expiresIn,
    userId: stored.userId,
  });

  sendJson(res, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: expiresIn,
  });
}

async function handleOAuthToken({
  state,
  req,
  res,
}: RouteContext): Promise<void> {
  // Rate limit token endpoint per IP
  if (throttleOAuthRequest({ state, req, res })) return;

  const raw = await readBodyOrSend413({ req, res });
  if (raw === null) return;

  const request = validateTokenRequest({ res, params: parseFormBody(raw) });
  if (!request) return;

  // Look up auth code from Redis
  if (!redis) {
    sendJson(res, 500, { error: "server_error" });
    return;
  }

  const authCodeData = await takeAuthCode({
    client: redis,
    res,
    code: request.code,
  });
  if (authCodeData === null) return;

  const stored = parseStoredAuthCode({ res, authCodeData });
  if (!stored) return;

  if (!verifyAuthCode({ res, stored, request })) return;

  await issueAccessToken({ state, res, stored });
}

/**
 * WORKAROUND: The SDK transport starts uninitialized — we patch its inner
 * state so it accepts non-init requests with the existing session ID. This
 * accesses private fields of the SDK's StreamableHTTPServerTransport wrapper
 * and the underlying WebStandardStreamableHTTPServerTransport.
 * Tested against @modelcontextprotocol/sdk@1.26.0.
 * See: https://github.com/modelcontextprotocol/typescript-sdk/issues/1658
 *
 * Returns false when the SDK's internal structure no longer matches.
 */
function primeRecoveredTransport({
  transport,
  sessionId,
}: {
  transport: StreamableHTTPServerTransport;
  sessionId: string;
}): boolean {
  // Runtime assertion: verify the internal structure hasn't changed
  const transportAny = transport as unknown as Record<string, unknown>;
  if (
    !transportAny._webStandardTransport ||
    typeof transportAny._webStandardTransport !== "object"
  ) {
    return false;
  }

  const inner = transportAny._webStandardTransport as Record<string, unknown>;
  inner._initialized = true;
  inner.sessionId = sessionId;
  return true;
}

/** Outcome of recreating a session that lives in Redis on another pod. */
type SessionRecovery =
  | { outcome: "recovered"; session: SessionState }
  | { outcome: "unavailable" }
  | { outcome: "failed" };

/** L2: Redis lookup — session may live on another pod. */
async function recoverSessionFromRedis({
  state,
  res,
  sessionId,
  incomingToken,
}: {
  state: McpHandlerState;
  res: ServerResponse;
  sessionId: string;
  incomingToken: string | null;
}): Promise<SessionRecovery> {
  const redisApiKey = await getSessionFromRedis(sessionId);
  if (!redisApiKey) return { outcome: "unavailable" };

  // Recreate transport locally for this pod.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  });

  if (!primeRecoveredTransport({ transport, sessionId })) {
    logger.error(
      "StreamableHTTPServerTransport internal structure changed — " +
        "Redis session recovery unavailable. Update the SDK workaround.",
    );
    sendJson(res, 500, { error: "Internal server error" });
    return { outcome: "failed" };
  }

  // Re-resolve to recover OAuth userId if the token still has one;
  // graceful degradation to undefined for direct-apiKey sessions.
  const recoveredCtx = incomingToken
    ? await resolveSessionContext({ state, token: incomingToken })
    : null;
  const session: SessionState = {
    transport,
    apiKey: redisApiKey,
    userId: recoveredCtx?.userId,
    lastActivityAt: Date.now(),
  };
  state.sessions.set(sessionId, session);

  transport.onclose = () => {
    state.sessions.delete(sessionId);
  };

  const sessionServer = createMcpServer();
  registerGovernanceMcpTools(sessionServer, {
    prisma,
    apiKey: redisApiKey,
    callerUserId: recoveredCtx?.userId,
  });
  await handleWithSessionConfig(redisApiKey, () =>
    sessionServer.connect(transport),
  );

  return { outcome: "recovered", session };
}

/**
 * Serve a POST against an existing session — the local Map first, then one
 * recovered from Redis. Returns false when no such session exists, leaving
 * the caller to treat the request as a new session.
 */
async function serveExistingSession({
  state,
  req,
  res,
  post,
}: RouteContext & {
  post: { sessionId: string; body: unknown; incomingToken: string | null };
}): Promise<boolean> {
  const { sessionId, body, incomingToken } = post;
  let known = state.sessions.get(sessionId);

  if (!known) {
    const recovery = await recoverSessionFromRedis({
      state,
      res,
      sessionId,
      incomingToken,
    });
    if (recovery.outcome === "failed") return true;
    if (recovery.outcome === "unavailable") return false;
    known = recovery.session;
  }
  const session = known;

  if (!(await verifySessionBearer({ state, req, res, session }))) return true;

  session.lastActivityAt = Date.now();
  touchSessionInRedis(sessionId, session.apiKey).catch(() => {});
  await handleWithSessionConfig(session.apiKey, () =>
    session.transport.handleRequest(req, res, body),
  );
  return true;
}

/** New session — the request must be an initialize request. */
async function startNewSession({
  state,
  req,
  res,
  init,
}: RouteContext & {
  init: { body: unknown; incomingToken: string | null };
}): Promise<void> {
  // Rate limit failed auth attempts (check only — track on failure in authenticateRequest)
  const ip = getClientIp(req);
  if (state.authFailRateLimiter.isBlocked(ip)) {
    sendJson(res, 429, { error: "Too many requests" });
    return;
  }

  const apiKey = await authenticateRequest({ state, req, res });
  if (!apiKey) return; // 401 already sent

  // Re-resolve the token to recover the OAuth-flowing userId (if any)
  // for governance MCP tool attribution. authenticateRequest only
  // returns the apiKey, but resolveSessionContext is cheap and the
  // entry was just populated.
  const initialCtx = init.incomingToken
    ? await resolveSessionContext({ state, token: init.incomingToken })
    : null;
  const userId = initialCtx?.userId;

  // Per-key session limit (cross-pod via Redis)
  if ((await sessionCountForKey({ state, apiKey })) >= MAX_SESSIONS_PER_KEY) {
    sendJson(res, 429, {
      error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
    });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      state.sessions.set(id, {
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
      state.sessions.delete(transport.sessionId);
      removeSessionFromRedis(transport.sessionId, apiKey).catch(() => {});
    }
  };

  const sessionServer = createMcpServer();
  registerGovernanceMcpTools(sessionServer, {
    prisma,
    apiKey,
    callerUserId: userId,
  });
  await handleWithSessionConfig(apiKey, () => sessionServer.connect(transport));

  await handleWithSessionConfig(apiKey, () =>
    transport.handleRequest(req, res, init.body),
  );
}

async function handleMcpPost({ state, req, res }: RouteContext): Promise<void> {
  const raw = await readBodyOrSend413({ req, res });
  if (raw === null) return;
  const parsed = parseJsonBodyOrSend400({ res, raw });
  if (!parsed) return;
  const body = parsed.body;

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  // Extract once at the top — reused on session-recovery path to recover
  // the OAuth-flowing userId (governance tools attribution) and on the
  // existing-session path for Bearer match validation.
  const incomingToken = extractBearerToken(req);

  // Existing session — check local Map first, then Redis
  if (
    sessionId &&
    (await serveExistingSession({
      state,
      req,
      res,
      post: { sessionId, body, incomingToken },
    }))
  ) {
    return;
  }

  // New session — must be an initialize request
  if (
    (!sessionId || !state.sessions.has(sessionId)) &&
    isInitializeRequest(body)
  ) {
    await startNewSession({
      state,
      req,
      res,
      init: { body, incomingToken },
    });
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

async function handleMcpGet({ state, req, res }: RouteContext): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const session = sessionId ? state.sessions.get(sessionId) : undefined;

  if (sessionId && session) {
    if (!(await verifySessionBearer({ state, req, res, session }))) return;

    session.lastActivityAt = Date.now();
    touchSessionInRedis(sessionId, session.apiKey).catch(() => {});
    await handleWithSessionConfig(session.apiKey, () =>
      session.transport.handleRequest(req, res),
    );
  } else if (sessionId) {
    send401(res, "Session expired or not found");
  } else {
    sendJson(res, 400, { error: "Invalid request — no valid session ID" });
  }
}

async function handleMcpDelete({
  state,
  req,
  res,
}: RouteContext): Promise<void> {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && state.sessions.has(sessionId)) {
    const session = state.sessions.get(sessionId)!;

    if (!(await verifySessionBearer({ state, req, res, session }))) return;

    await session.transport.close();
    state.sessions.delete(sessionId);
    removeSessionFromRedis(sessionId, session.apiKey).catch(() => {});
    sendJson(res, 200, { status: "session closed" });
  } else {
    sendJson(res, 404, { error: "Session not found" });
  }
}

// ---------------------------------------------------------------------------
// SSE transport handlers (ChatGPT, etc.)
// ---------------------------------------------------------------------------

async function handleSseConnect({
  state,
  req,
  res,
}: RouteContext): Promise<void> {
  const apiKey = await authenticateRequest({ state, req, res });
  if (!apiKey) return;

  const sseToken = extractBearerToken(req);
  const sseCtx = sseToken
    ? await resolveSessionContext({ state, token: sseToken })
    : null;
  const sseUserId = sseCtx?.userId;

  if ((await sessionCountForKey({ state, apiKey })) >= MAX_SESSIONS_PER_KEY) {
    sendJson(res, 429, {
      error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
    });
    return;
  }

  const transport = new SSEServerTransport("/messages", res);
  state.sseSessions.set(transport.sessionId, {
    transport,
    apiKey,
    userId: sseUserId,
    lastActivityAt: Date.now(),
  });

  const sessionServer = createMcpServer();
  registerGovernanceMcpTools(sessionServer, {
    prisma,
    apiKey,
    callerUserId: sseUserId,
  });

  res.on("close", () => {
    state.sseSessions.delete(transport.sessionId);
  });

  await handleWithSessionConfig(apiKey, () => sessionServer.connect(transport));
}

async function handleSseMessage({
  state,
  req,
  res,
}: RouteContext): Promise<void> {
  const url = new URL(req.url ?? "", "http://localhost");
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId || !state.sseSessions.has(sessionId)) {
    sendJson(res, 400, { error: "Invalid or missing session ID" });
    return;
  }

  const session = state.sseSessions.get(sessionId)!;

  // Re-authenticate: verify Bearer token matches the session
  if (!(await verifySessionBearer({ state, req, res, session }))) return;

  session.lastActivityAt = Date.now();

  const raw = await readBodyOrSend413({ req, res });
  if (raw === null) return;
  const parsed = parseJsonBodyOrSend400({ res, raw });
  if (!parsed) return;

  await handleWithSessionConfig(session.apiKey, () =>
    session.transport.handlePostMessage(req, res, parsed.body),
  );
}

// ---------------------------------------------------------------------------
// Main request dispatcher
// ---------------------------------------------------------------------------

type RouteHandler = (ctx: RouteContext) => void | Promise<void>;

/**
 * pathname → method → handler. A known path with an unlisted method is a 405,
 * an unknown path a 404. Maps, not objects — both keys come from user input.
 */
const METHOD_ROUTES = new Map<string, Map<string, RouteHandler>>([
  [
    "/.well-known/oauth-protected-resource",
    new Map([["GET", handleProtectedResourceMetadata]]),
  ],
  [
    "/.well-known/oauth-authorization-server",
    new Map([["GET", handleOAuthMetadata]]),
  ],
  ["/oauth/register", new Map([["POST", handleOAuthRegister]])],
  ["/oauth/token", new Map([["POST", handleOAuthToken]])],
  [
    "/mcp",
    new Map([
      ["POST", handleMcpPost],
      ["GET", handleMcpGet],
      ["DELETE", handleMcpDelete],
    ]),
  ],
  ["/sse", new Map([["GET", handleSseConnect]])],
  ["/messages", new Map([["POST", handleSseMessage]])],
]);

async function dispatchRoute({
  state,
  req,
  res,
  route,
}: RouteContext & {
  route: { pathname: string; method: string };
}): Promise<void> {
  // The health check answers on any method.
  if (route.pathname === "/mcp/health") {
    handleHealthCheck({ state, req, res });
    return;
  }

  const methods = METHOD_ROUTES.get(route.pathname);
  if (!methods) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const handler = methods.get(route.method);
  if (!handler) {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  await handler({ state, req, res });
}

function handleRequest({ state, req, res }: RouteContext): void {
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

  dispatchRoute({ state, req, res, route: { pathname, method } }).catch(
    (err) => {
      logger.error({ error: err, url: req.url }, "MCP handler error");
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" });
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Ensure the MCP config is initialized with the app's endpoint. */
function ensureMcpConfig(): void {
  try {
    getConfig();
  } catch {
    initConfig({
      endpoint: process.env.BASE_HOST ?? "https://app.langwatch.ai",
    });
  }
}

function closeAllSessions({
  state,
  reaper,
}: {
  state: McpHandlerState;
  reaper: NodeJS.Timeout;
}): void {
  clearInterval(reaper);
  for (const [id, session] of state.sessions) {
    session.transport.close().catch(() => {});
    state.sessions.delete(id);
  }
  for (const [id, session] of state.sseSessions) {
    session.transport.close().catch(() => {});
    state.sseSessions.delete(id);
  }
}

/**
 * Creates an MCP handler instance that manages sessions, OAuth tokens,
 * and routes for the Streamable HTTP transport.
 */
export function createMcpHandler(): McpHandler {
  ensureMcpConfig();

  const state: McpHandlerState = {
    // Use Map to avoid prototype pollution — sessionId comes from user input
    sessions: new Map(),
    sseSessions: new Map(),
    oauthTokens: new Map(),
    oauthRateLimiter: createRateLimiter({ windowMs: 60_000, maxRequests: 10 }),
    authFailRateLimiter: createRateLimiter({
      windowMs: 60_000,
      maxRequests: 20,
    }),
  };

  const reaper = setInterval(() => reapExpiredState(state), REAPER_INTERVAL_MS);

  // Allow the process to exit naturally even if the reaper is still scheduled
  reaper.unref();

  return {
    handleRequest: (req, res) => handleRequest({ state, req, res }),
    isMcpRoute,
    clearTokenCache: () => state.oauthTokens.clear(),
    clearRateLimiters: () => {
      state.oauthRateLimiter.clear();
      state.authFailRateLimiter.clear();
    },
    closeAllSessions: () => closeAllSessions({ state, reaper }),
  };
}
