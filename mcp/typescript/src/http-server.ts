import express from "express";
import type { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID, createHash } from "node:crypto";
import type { Server } from "node:http";

import { getConfig, runWithConfig } from "./config.js";
import { createMcpServer } from "./create-mcp-server.js";
import {
  apiKeysMatch,
  createApiKeyVerifier,
  createRateLimiter,
  createSessionStore,
  DEFAULT_BIND_HOST,
  isOriginAllowed,
  parseAllowedOrigins,
  type ApiKeyVerifier,
} from "./http-security.js";

/** Idle time after which a session is closed and forgotten. */
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** How often the reaper sweeps sessions, tokens, and rate limiter state. */
const REAPER_INTERVAL_MS = 60 * 1000;

/** Concurrent sessions a single API key may hold across both transports. */
const MAX_SESSIONS_PER_KEY = 20;

/** OAuth access token lifetime. */
const OAUTH_TOKEN_TTL_SECONDS = 3600;

/** An OAuth access token and the API key it was minted from. */
interface OAuthTokenEntry {
  apiKey: string;
  expiresAt: number;
}

/**
 * Reads the raw Bearer token from the Authorization header.
 * Expects the format: `Bearer <token>`.
 */
function readBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7) || null;
}

/**
 * Generates an opaque access token.
 */
function generateAccessToken(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

/**
 * Wraps the request handling inside `runWithConfig()` so that all downstream
 * tool calls (which read config via `getConfig()`/`requireApiKey()`) see the
 * per-session API key instead of the global one.
 */
async function handleWithSessionConfig<T>(
  apiKey: string,
  fn: () => Promise<T>
): Promise<T> {
  const baseConfig = getConfig();
  return runWithConfig({ ...baseConfig, apiKey }, fn);
}

export interface StartHttpServerOptions {
  port: number;
  /**
   * Listen address. Defaults to loopback. Set it to `0.0.0.0` to accept
   * connections from outside the machine, which also means listing every
   * browser origin that should be able to reach the server.
   */
  host?: string;
  /** Browser origins accepted in addition to loopback. */
  allowedOrigins?: string[];
  /** Overrides the API key verifier, for tests. */
  apiKeyVerifier?: ApiKeyVerifier;
}

export interface StartedHttpServer {
  server: Server;
  port: number;
  host: string;
  allowedOrigins: string[];
}

/**
 * Starts an Express HTTP server with Streamable HTTP and legacy SSE transports
 * for the LangWatch MCP server.
 *
 * Every request carries `Authorization: Bearer <key>`. The key is verified
 * against the LangWatch API before any per-session state is allocated, and
 * re-checked on every subsequent request against the key the session was
 * created with, so a session id on its own authorizes nothing.
 *
 * Endpoints:
 * - GET /health - Health check for Kubernetes probes (no auth)
 * - POST/GET/DELETE /mcp - Streamable HTTP transport (modern)
 * - GET /sse - Legacy SSE transport (backwards compatibility)
 * - POST /messages - Legacy SSE message endpoint
 */
export async function startHttpServer({
  port,
  host,
  allowedOrigins,
  apiKeyVerifier,
}: StartHttpServerOptions): Promise<StartedHttpServer> {
  const bindHost =
    host ?? process.env.LANGWATCH_MCP_HTTP_HOST ?? DEFAULT_BIND_HOST;
  const originAllowlist =
    allowedOrigins ??
    parseAllowedOrigins(process.env.LANGWATCH_MCP_ALLOWED_ORIGINS);

  const app = express();
  // Behind a reverse proxy the forwarded headers are what carry the client
  // address and the external scheme, so the per-IP rate limiter and the OAuth
  // metadata document both depend on this. It is only as trustworthy as the
  // proxy in front of it: with the port exposed directly, a client can put any
  // address in X-Forwarded-For. Set LANGWATCH_MCP_TRUST_PROXY=false when
  // nothing trusted terminates in front of the server.
  app.set("trust proxy", process.env.LANGWATCH_MCP_TRUST_PROXY !== "false");
  app.use(express.json());

  const verifier =
    apiKeyVerifier ?? createApiKeyVerifier({ endpoint: getConfig().endpoint });

  /** OAuth access tokens minted by this server, keyed by token. */
  const oauthTokens = new Map<string, OAuthTokenEntry>();

  /**
   * Resolves a Bearer token to the API key it stands for. OAuth-issued access
   * tokens map back to the key they were minted from; anything else is treated
   * as a direct API key. This only translates the token, it does not decide
   * whether the key is valid.
   */
  function resolveApiKey(token: string): string | null {
    const oauthEntry = oauthTokens.get(token);
    if (!oauthEntry) return token;

    if (Date.now() < oauthEntry.expiresAt) return oauthEntry.apiKey;

    oauthTokens.delete(token);
    return null;
  }

  // Failed authentication is rate limited per IP so an attacker cannot spray
  // candidate keys or turn one flood into unbounded verification traffic.
  const authFailRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 20,
  });
  const oauthRateLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 10,
  });

  const sessions = createSessionStore<StreamableHTTPServerTransport>({
    maxAgeMs: SESSION_MAX_AGE_MS,
    closeTransport: (transport) =>
      void transport.close().catch(() => undefined),
  });
  const sseSessions = createSessionStore<SSEServerTransport>({
    maxAgeMs: SESSION_MAX_AGE_MS,
    closeTransport: (transport) =>
      void transport.close().catch(() => undefined),
  });

  const reaper = setInterval(() => {
    sessions.sweep();
    sseSessions.sweep();

    const now = Date.now();
    for (const [token, entry] of oauthTokens) {
      if (now >= entry.expiresAt) oauthTokens.delete(token);
    }

    verifier.sweep();
    authFailRateLimiter.sweep();
    oauthRateLimiter.sweep();
  }, REAPER_INTERVAL_MS);

  // Let the process exit naturally even while the reaper is scheduled.
  reaper.unref();

  function clientIp(req: Request): string {
    return req.ip ?? req.socket.remoteAddress ?? "unknown";
  }

  // --- Origin validation and CORS ---
  //
  // The MCP transport specification requires servers to validate Origin on
  // every incoming connection, because a page on an attacker's domain can
  // point DNS at loopback and reach a server that only checks the token.
  // Requests with no Origin header are not browser requests, so they pass:
  // browsers always send Origin on the cross-origin requests this guards.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    if (typeof origin === "string" && origin.length > 0) {
      if (!isOriginAllowed(origin, originAllowlist)) {
        res.status(403).json({ error: "Origin not allowed" });
        return;
      }
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      // A cross-origin client cannot read a response header unless it is
      // exposed, and the Streamable HTTP transport reads the session id off
      // the initialize response.
      res.header(
        "Access-Control-Expose-Headers",
        "Mcp-Session-Id, MCP-Protocol-Version"
      );
    }

    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, MCP-Protocol-Version"
    );

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Health check endpoint for Kubernetes probes
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  function sendUnauthorized(res: Response, error: string): void {
    res.status(401).json({ error });
  }

  /**
   * Resolves and verifies the Bearer token on a request that is not yet bound
   * to a session. Sends the error response itself and returns null when the
   * request should not proceed.
   */
  async function authenticate(
    req: Request,
    res: Response
  ): Promise<string | null> {
    const ip = clientIp(req);
    if (authFailRateLimiter.isBlocked(ip)) {
      res.status(429).json({ error: "Too many requests" });
      return null;
    }

    const token = readBearerToken(req);
    if (!token) {
      sendUnauthorized(
        res,
        "Authorization: Bearer <LANGWATCH_API_KEY> header required"
      );
      return null;
    }

    const apiKey = resolveApiKey(token);
    if (!apiKey) {
      authFailRateLimiter.track(ip);
      sendUnauthorized(res, "Invalid or expired token");
      return null;
    }

    if (!(await verifier.verify(apiKey))) {
      authFailRateLimiter.track(ip);
      sendUnauthorized(res, "Invalid API key");
      return null;
    }

    return apiKey;
  }

  /**
   * Re-checks the Bearer token on a request that names an existing session.
   * The token has to resolve to the same key the session was created with, so
   * possession of a session id grants nothing on its own, and the key has to
   * still be live, so revoking a key ends its sessions within the verifier's
   * cache window rather than at the session TTL.
   */
  async function authenticateForSession(
    req: Request,
    res: Response,
    sessionApiKey: string
  ): Promise<boolean> {
    const ip = clientIp(req);
    if (authFailRateLimiter.isBlocked(ip)) {
      res.status(429).json({ error: "Too many requests" });
      return false;
    }

    const token = readBearerToken(req);
    if (!token) {
      sendUnauthorized(
        res,
        "Authorization: Bearer <LANGWATCH_API_KEY> header required"
      );
      return false;
    }

    const apiKey = resolveApiKey(token);
    if (!apiKey || !apiKeysMatch(apiKey, sessionApiKey)) {
      authFailRateLimiter.track(ip);
      sendUnauthorized(res, "Bearer token does not match session");
      return false;
    }

    if (!(await verifier.verify(apiKey))) {
      authFailRateLimiter.track(ip);
      sendUnauthorized(res, "Invalid API key");
      return false;
    }

    return true;
  }

  /** True when the key is already at its concurrent session limit. */
  function overSessionLimit(apiKey: string): boolean {
    return (
      sessions.countForKey(apiKey) + sseSessions.countForKey(apiKey) >=
      MAX_SESSIONS_PER_KEY
    );
  }

  // --- OAuth 2.0 endpoints (for Claude Desktop and other OAuth-only clients) ---

  app.get(
    "/.well-known/oauth-authorization-server",
    (_req: Request, res: Response) => {
      const baseUrl = `${_req.protocol}://${_req.get("host")}`;
      res.json({
        issuer: baseUrl,
        token_endpoint: `${baseUrl}/oauth/token`,
        token_endpoint_auth_methods_supported: ["client_secret_post"],
        grant_types_supported: ["client_credentials"],
        response_types_supported: [],
        scopes_supported: ["mcp:tools"],
      });
    }
  );

  // URL-encoded body parser for OAuth token endpoint (RFC 6749 requires
  // application/x-www-form-urlencoded)
  app.post(
    "/oauth/token",
    express.urlencoded({ extended: false }),
    async (req: Request, res: Response) => {
      const ip = clientIp(req);
      if (oauthRateLimiter.isBlocked(ip)) {
        res.status(429).json({ error: "Too many requests" });
        return;
      }
      oauthRateLimiter.track(ip);

      const grantType = req.body.grant_type;

      if (grantType !== "client_credentials") {
        res.status(400).json({
          error: "unsupported_grant_type",
          error_description:
            "Only client_credentials grant type is supported",
        });
        return;
      }

      // Accept client_secret as the LangWatch API key.
      // client_id is ignored, the API key identifies the project.
      const clientSecret = req.body.client_secret;

      if (!clientSecret || typeof clientSecret !== "string") {
        res.status(400).json({
          error: "invalid_request",
          error_description:
            "client_secret is required (use your LangWatch API key)",
        });
        return;
      }

      // Minting a token for an unverified key would let anyone fill the token
      // map with entries that go on to allocate sessions.
      if (!(await verifier.verify(clientSecret))) {
        res.status(401).json({
          error: "invalid_client",
          error_description: "client_secret is not a valid LangWatch API key",
        });
        return;
      }

      const accessToken = generateAccessToken();

      oauthTokens.set(accessToken, {
        apiKey: clientSecret,
        expiresAt: Date.now() + OAUTH_TOKEN_TTL_SECONDS * 1000,
      });

      res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: OAUTH_TOKEN_TTL_SECONDS,
        scope: "mcp:tools",
      });
    }
  );

  // --- Streamable HTTP transport (modern) ---

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (sessionId && session) {
      if (!(await authenticateForSession(req, res, session.apiKey))) return;

      sessions.touch(sessionId);
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleRequest(req, res, req.body)
      );
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const apiKey = await authenticate(req, res);
      if (!apiKey) return;

      if (overSessionLimit(apiKey)) {
        res.status(429).json({
          error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.add(id, transport, apiKey);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.remove(transport.sessionId);
        }
      };

      const sessionServer = createMcpServer();
      await handleWithSessionConfig(apiKey, () =>
        sessionServer.connect(transport)
      );

      await handleWithSessionConfig(apiKey, () =>
        transport.handleRequest(req, res, req.body)
      );
      return;
    }

    if (sessionId) {
      sendUnauthorized(res, "Session expired or not found");
      return;
    }

    res.status(400).json({
      error: "Invalid request, no session ID or not an initialize request",
    });
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (sessionId && session) {
      if (!(await authenticateForSession(req, res, session.apiKey))) return;

      sessions.touch(sessionId);
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleRequest(req, res)
      );
      return;
    }

    if (sessionId) {
      sendUnauthorized(res, "Session expired or not found");
      return;
    }

    res.status(400).json({ error: "Invalid request, no valid session ID" });
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (!sessionId || !session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (!(await authenticateForSession(req, res, session.apiKey))) return;

    sessions.remove(sessionId);
    await session.transport.close();
    res.status(200).json({ status: "session closed" });
  });

  // --- Legacy SSE transport (backwards compatibility) ---

  app.get("/sse", async (req: Request, res: Response) => {
    const apiKey = await authenticate(req, res);
    if (!apiKey) return;

    if (overSessionLimit(apiKey)) {
      res.status(429).json({
        error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
      });
      return;
    }

    const transport = new SSEServerTransport("/messages", res);
    sseSessions.add(transport.sessionId, transport, apiKey);

    const sessionServer = createMcpServer();

    // Clean up when the SSE connection closes
    res.on("close", () => {
      sseSessions.remove(transport.sessionId);
    });

    await handleWithSessionConfig(apiKey, () =>
      sessionServer.connect(transport)
    );
  });

  // Handle POST messages, mounted at both /messages and /sse/messages
  // because some clients resolve the relative /messages URL differently.
  //
  // The session id travels in the query string because the SSE transport hands
  // the client its POST endpoint as a URI. It identifies the session and
  // nothing more: the Bearer token below is what authorizes the request.
  const handleSseMessage = async (req: Request, res: Response) => {
    const sessionId = req.query["sessionId"] as string | undefined;
    const session = sessionId ? sseSessions.get(sessionId) : undefined;

    if (!sessionId || !session) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }

    if (!(await authenticateForSession(req, res, session.apiKey))) return;

    sseSessions.touch(sessionId);
    await handleWithSessionConfig(session.apiKey, () =>
      session.transport.handlePostMessage(req, res, req.body)
    );
  };

  app.post("/messages", handleSseMessage);
  app.post("/sse/messages", handleSseMessage);

  // Start the server
  return new Promise((resolve) => {
    const server = app.listen(port, bindHost, () => {
      const addr = server.address();
      const resolvedPort =
        typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server,
        port: resolvedPort,
        host: bindHost,
        allowedOrigins: originAllowlist,
      });
    });

    server.on("close", () => {
      clearInterval(reaper);
      sessions.closeAll();
      sseSessions.closeAll();
    });
  });
}
