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
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:mcp");

/** Redis key prefix for OAuth tokens. */
const REDIS_TOKEN_PREFIX = "mcp:oauth:token:";

/** OAuth token TTL in seconds. */
const TOKEN_TTL_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-session state: the transport and the API key provided at session creation. */
interface SessionState {
  transport: StreamableHTTPServerTransport;
  apiKey: string;
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

  const sessions: Record<string, SessionState> = {};
  const oauthTokens = new Map<string, OAuthTokenEntry>();

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
  // CORS
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

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
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
   * Checks in-memory OAuth tokens first, then Redis, and falls back to
   * treating the token as a direct API key.
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

    // 2. Check Redis for OAuth token
    if (redis) {
      try {
        const redisData = await redis.get(`${REDIS_TOKEN_PREFIX}${token}`);
        if (redisData) {
          const entry: OAuthTokenEntry = JSON.parse(redisData);
          if (Date.now() < entry.expiresAt) {
            // Re-populate in-memory cache
            oauthTokens.set(token, entry);
            return entry.apiKey;
          }
          // Expired — clean up Redis
          await redis.del(`${REDIS_TOKEN_PREFIX}${token}`);
          return null;
        }
      } catch (err) {
        logger.error({ error: err }, "Redis token lookup failed");
      }
    }

    // 3. Treat as direct API key
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
      setCorsHeaders(res);
      sendJson(res, 401, {
        error:
          "Authorization: Bearer <LANGWATCH_API_KEY> header required",
      });
      return null;
    }

    const apiKey = await resolveApiKey(token);
    if (!apiKey) {
      setCorsHeaders(res);
      sendJson(res, 401, { error: "Invalid or expired token" });
      return null;
    }

    const project = await validateApiKey(apiKey);
    if (!project) {
      setCorsHeaders(res);
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

    // Store in memory
    oauthTokens.set(accessToken, entry);

    // Store in Redis
    if (redis) {
      try {
        await redis.set(
          `${REDIS_TOKEN_PREFIX}${accessToken}`,
          JSON.stringify(entry),
          "EX",
          expiresIn,
        );
      } catch (err) {
        logger.error({ error: err }, "Failed to store OAuth token in Redis");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Route handlers
  // -------------------------------------------------------------------------

  function handleHealthCheck(_req: IncomingMessage, res: ServerResponse): void {
    setCorsHeaders(res);
    sendJson(res, 200, { status: "ok" });
  }

  function handleOAuthMetadata(
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    setCorsHeaders(res);
    const protocol = req.headers["x-forwarded-proto"] ?? "http";
    const host = req.headers.host ?? "localhost";
    const baseUrl = `${protocol}://${host}`;

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
    setCorsHeaders(res);
    const raw = await readBody(req);
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
    setCorsHeaders(res);

    const raw = await readBody(req);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Existing session — handle request
    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleRequest(req, res, body),
      );
      return;
    }

    // New session — must be an initialize request
    if (!sessionId && isInitializeRequest(body)) {
      const apiKey = await authenticateRequest(req, res);
      if (!apiKey) return; // 401 already sent

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions[id] = { transport, apiKey };
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          delete sessions[transport.sessionId];
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
    setCorsHeaders(res);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
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
    setCorsHeaders(res);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      await session.transport.close();
      delete sessions[sessionId];
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
    const pathname = url.split("?")[0];
    const method = req.method ?? "GET";

    // Handle OPTIONS preflight for any MCP route
    if (method === "OPTIONS" && isMcpRoute(pathname!)) {
      setCorsHeaders(res);
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
    for (const [id, session] of Object.entries(sessions)) {
      session.transport.close().catch(() => {});
      delete sessions[id];
    }
  }

  return {
    handleRequest,
    isMcpRoute,
    clearTokenCache,
    closeAllSessions,
  };
}
