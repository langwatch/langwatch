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

/** OAuth token TTL in seconds. */
const TOKEN_TTL_SECONDS = 3600;

/** Max concurrent sessions per API key. */
const MAX_SESSIONS_PER_KEY = 20;

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
    isAllowed(ip: string): boolean {
      const now = Date.now();
      const entry = entries.get(ip);

      if (!entry || now - entry.windowStart > windowMs) {
        entries.set(ip, { count: 1, windowStart: now });
        return true;
      }

      entry.count++;
      return entry.count <= maxRequests;
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

/** Per-session state: the transport and the API key provided at session creation. */
interface SessionState {
  transport: StreamableHTTPServerTransport;
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
      endpoint: process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai",
    });
  }

  // Use Map to avoid prototype pollution — sessionId comes from user input
  const sessions = new Map<string, SessionState>();
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

  const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
  const REAPER_INTERVAL_MS = 60 * 1000; // 60 seconds

  const reaper = setInterval(() => {
    const now = Date.now();

    // Sweep idle sessions
    for (const [id, session] of sessions) {
      if (now - session.lastActivityAt > SESSION_MAX_AGE_MS) {
        session.transport.close().catch(() => {});
        sessions.delete(id);
      }
    }

    // Sweep expired OAuth tokens
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
    "/.well-known/oauth-authorization-server",
    "/oauth/token",
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

  const MAX_BODY_BYTES = 1_048_576; // 1 MB

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
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") return forwarded.split(",")[0]!.trim();
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
  async function authenticateRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<string | null> {
    const token = extractBearerToken(req);
    if (!token) {
      sendJson(res, 401, {
        error:
          "Authorization: Bearer <LANGWATCH_API_KEY> header required",
      });
      return null;
    }

    const apiKey = await resolveApiKey(token);
    if (!apiKey) {
      authFailRateLimiter.isAllowed(getClientIp(req)); // track failure
      sendJson(res, 401, { error: "Invalid or expired token" });
      return null;
    }

    const project = await validateApiKey(apiKey);
    if (!project) {
      authFailRateLimiter.isAllowed(getClientIp(req)); // track failure
      sendJson(res, 401, { error: "Invalid API key" });
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
  // Session helpers
  // -------------------------------------------------------------------------

  function sessionCountForKey(apiKey: string): number {
    let count = 0;
    for (const session of sessions.values()) {
      if (session.apiKey === apiKey) count++;
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Route handlers
  // -------------------------------------------------------------------------

  function handleHealthCheck(_req: IncomingMessage, res: ServerResponse): void {
    sendJson(res, 200, { status: "ok" });
  }

  function handleOAuthMetadata(
    _req: IncomingMessage,
    res: ServerResponse,
  ): void {
    // Use configured endpoint to prevent host header injection
    const baseUrl =
      process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

    sendJson(res, 200, {
      issuer: baseUrl,
      token_endpoint: `${baseUrl}/oauth/token`,
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      grant_types_supported: ["client_credentials"],
      response_types_supported: [],
      scopes_supported: ["mcp:tools"],
    });
  }

  async function handleOAuthToken(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // Rate limit token endpoint per IP
    if (!oauthRateLimiter.isAllowed(getClientIp(req))) {
      sendJson(res, 429, { error: "Too many requests" });
      return;
    }

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

    if (params.grant_type !== "client_credentials") {
      sendJson(res, 400, {
        error: "unsupported_grant_type",
        error_description:
          "Only client_credentials grant type is supported",
      });
      return;
    }

    const clientSecret = params.client_secret;
    if (!clientSecret) {
      sendJson(res, 400, {
        error: "invalid_request",
        error_description:
          "client_secret is required (use your LangWatch API key)",
      });
      return;
    }

    // Validate the API key against the database
    const project = await validateApiKey(clientSecret);
    if (!project) {
      sendJson(res, 401, {
        error: "invalid_client",
        error_description: "Invalid API key",
      });
      return;
    }

    const expiresIn = TOKEN_TTL_SECONDS;
    const accessToken = generateAccessToken();

    await storeOAuthToken(accessToken, clientSecret, expiresIn);

    sendJson(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
      scope: "mcp:tools",
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

    // Existing session — verify Bearer token matches, then handle request
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;

      // Re-authenticate: verify the Bearer token resolves to the same API key
      const token = extractBearerToken(req);
      if (token) {
        const apiKey = await resolveApiKey(token);
        if (apiKey !== session.apiKey) {
          sendJson(res, 401, { error: "Bearer token does not match session" });
          return;
        }
      }

      session.lastActivityAt = Date.now();
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleRequest(req, res, body),
      );
      return;
    }

    // New session — must be an initialize request
    if (!sessionId && isInitializeRequest(body)) {
      // Rate limit failed auth attempts
      const ip = getClientIp(req);
      if (!authFailRateLimiter.isAllowed(ip)) {
        sendJson(res, 429, { error: "Too many requests" });
        return;
      }

      const apiKey = await authenticateRequest(req, res);
      if (!apiKey) return; // 401 already sent

      // Per-key session limit
      if (sessionCountForKey(apiKey) >= MAX_SESSIONS_PER_KEY) {
        sendJson(res, 429, {
          error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, apiKey, lastActivityAt: Date.now() });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
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

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      session.lastActivityAt = Date.now();
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

      // Verify the Bearer token matches the session owner
      const token = extractBearerToken(req);
      if (token) {
        const apiKey = await resolveApiKey(token);
        if (apiKey !== session.apiKey) {
          sendJson(res, 401, { error: "Bearer token does not match session" });
          return;
        }
      }

      await session.transport.close();
      sessions.delete(sessionId);
      sendJson(res, 200, { status: "session closed" });
    } else {
      sendJson(res, 404, { error: "Session not found" });
    }
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
        case "/.well-known/oauth-authorization-server":
          if (method === "GET") {
            handleOAuthMetadata(req, res);
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
  }

  return {
    handleRequest,
    isMcpRoute,
    clearTokenCache,
    closeAllSessions,
  };
}
