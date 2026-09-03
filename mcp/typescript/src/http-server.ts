import express from "express";
import type { Request, RequestHandler, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID, createHash } from "node:crypto";
import type { Server } from "node:http";

import { getConfig, runWithConfig } from "./config.js";
import { createMcpServer } from "./create-mcp-server.js";
import {
  admitOAuthToken,
  apiKeysMatch,
  createApiKeyVerifier,
  createRateLimiter,
  createSessionStore,
  DEFAULT_BIND_HOST,
  isOriginAllowed,
  parseAllowedOrigins,
  type ApiKeyVerifier,
  type OAuthTokenEntry,
  type RateLimiter,
  type SessionStore,
} from "./http-security.js";

/** Idle time after which a session is closed and forgotten. */
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/** How often the reaper sweeps sessions, tokens, and rate limiter state. */
const REAPER_INTERVAL_MS = 60 * 1000;

/** Concurrent sessions a single API key may hold across both transports. */
const MAX_SESSIONS_PER_KEY = 20;

/** OAuth access token lifetime. */
const OAUTH_TOKEN_TTL_SECONDS = 3600;
const MAX_OAUTH_TOKENS_PER_KEY = 10;

/** Per-server state that the route handlers operate on. */
interface ServerRuntime {
  verifier: ApiKeyVerifier;
  oauthTokens: Map<string, OAuthTokenEntry>;
  authFailRateLimiter: RateLimiter;
  oauthRateLimiter: RateLimiter;
  sessions: SessionStore<StreamableHTTPServerTransport>;
  sseSessions: SessionStore<SSEServerTransport>;
}

/**
 * Resolves and verifies the caller's Bearer token. When `expectedApiKey` is
 * given the token has to resolve to that same key, so possession of a session
 * id grants nothing on its own. Sends the error response itself and resolves to
 * null when the request must not proceed.
 */
type Authenticate = (args: {
  req: Request;
  res: Response;
  expectedApiKey?: string;
}) => Promise<string | null>;

/**
 * Reads the raw Bearer token from the Authorization header. RFC 7235 defines
 * the auth-scheme as case-insensitive, and some proxies rewrite its casing.
 */
function readBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  // Split on the first space rather than matching a pattern. The header is
  // attacker controlled and can be kilobytes long, and a scheme-then-token
  // regex backtracks over runs of whitespace.
  const header = authHeader.trim();
  const separator = header.indexOf(" ");
  if (separator === -1) return null;
  if (header.slice(0, separator).toLowerCase() !== "bearer") return null;

  return header.slice(separator + 1).trim() || null;
}

/** Generates an opaque access token. */
function generateAccessToken(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

/**
 * Client address used for rate limiting.
 *
 * Forwarded headers only mean something when a trusted proxy sets them, so this
 * reads the socket peer unless proxy trust is turned on explicitly. Defaulting
 * to the socket keeps the limits countable: a caller that reaches the port
 * directly cannot rotate `X-Forwarded-For` to reset its own counter. Where that
 * default is wrong, it is wrong in the strict direction, counting a whole proxy
 * as one client rather than not counting at all.
 */
function rateLimitKey(req: Request): string {
  if (process.env.LANGWATCH_MCP_TRUST_PROXY === "true") {
    return req.ip ?? req.socket.remoteAddress ?? "unknown";
  }
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * Resolves a Bearer token to the API key it stands for. OAuth-issued access
 * tokens map back to the key they were minted from; anything else is treated as
 * a direct API key. This only translates the token, it does not decide whether
 * the key is valid.
 */
function resolveApiKey({
  token,
  oauthTokens,
}: {
  token: string;
  oauthTokens: Map<string, OAuthTokenEntry>;
}): string | null {
  const oauthEntry = oauthTokens.get(token);
  if (!oauthEntry) return token;

  if (Date.now() < oauthEntry.expiresAt) return oauthEntry.apiKey;

  oauthTokens.delete(token);
  return null;
}

function sendUnauthorized({ res, error }: { res: Response; error: string }): void {
  res.status(401).json({ error });
}

/**
 * Wraps the request handling inside `runWithConfig()` so that all downstream
 * tool calls (which read config via `getConfig()`/`requireApiKey()`) see the
 * per-session API key instead of the global one.
 */
async function handleWithSessionConfig<T>(
  apiKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const baseConfig = getConfig();
  return runWithConfig({ ...baseConfig, apiKey }, fn);
}

/**
 * Origin validation and CORS.
 *
 * The MCP transport specification requires servers to validate Origin on every
 * incoming connection, because a page on an attacker's domain can point DNS at
 * loopback and reach a server that only checks the token. Requests with no
 * Origin header are not browser requests, so they pass: browsers always send
 * Origin on the cross-origin requests this guards.
 */
function createOriginMiddleware({
  allowedOrigins,
}: {
  allowedOrigins: readonly string[];
}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    if (typeof origin === "string" && origin.length > 0) {
      if (!isOriginAllowed({ origin, allowedOrigins })) {
        res.status(403).json({ error: "Origin not allowed" });
        return;
      }
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      // A cross-origin client cannot read a response header unless it is
      // exposed, and the Streamable HTTP transport reads the session id off
      // the initialize response.
      res.header("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version");
    }

    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, MCP-Protocol-Version",
    );
    res.header("X-Content-Type-Options", "nosniff");
    res.header("X-Frame-Options", "DENY");

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

function createAuthenticator(runtime: ServerRuntime): Authenticate {
  const { verifier, oauthTokens, authFailRateLimiter } = runtime;

  return async ({ req, res, expectedApiKey }) => {
    const ip = rateLimitKey(req);
    if (authFailRateLimiter.isBlocked(ip)) {
      res.status(429).json({ error: "Too many requests" });
      return null;
    }

    const token = readBearerToken(req);
    if (!token) {
      sendUnauthorized({
        res,
        error: "Authorization: Bearer <LANGWATCH_API_KEY> header required",
      });
      return null;
    }

    const apiKey = resolveApiKey({ token, oauthTokens });
    if (!apiKey) {
      authFailRateLimiter.track(ip);
      sendUnauthorized({ res, error: "Invalid or expired token" });
      return null;
    }

    if (
      expectedApiKey !== undefined &&
      !apiKeysMatch({ presentedKey: apiKey, expectedKey: expectedApiKey })
    ) {
      authFailRateLimiter.track(ip);
      sendUnauthorized({ res, error: "Bearer token does not match session" });
      return null;
    }

    // The key also has to still be live, so revoking a key ends its sessions
    // within the verifier's cache window rather than at the session TTL.
    if (!(await verifier.verify(apiKey))) {
      authFailRateLimiter.track(ip);
      sendUnauthorized({ res, error: "Invalid API key" });
      return null;
    }

    return apiKey;
  };
}

/** True when the key already holds its maximum concurrent sessions. */
function overSessionLimit({
  apiKey,
  sessions,
  sseSessions,
}: {
  apiKey: string;
  sessions: SessionStore<StreamableHTTPServerTransport>;
  sseSessions: SessionStore<SSEServerTransport>;
}): boolean {
  return (
    sessions.countForKey(apiKey) + sseSessions.countForKey(apiKey) >= MAX_SESSIONS_PER_KEY
  );
}

function sendSessionLimitReached(res: Response): void {
  res.status(429).json({
    error: `Too many concurrent sessions (max ${MAX_SESSIONS_PER_KEY})`,
  });
}

/** OAuth 2.0 endpoints, for Claude Desktop and other OAuth-only clients. */
function registerOAuthRoutes({
  app,
  runtime,
}: {
  app: express.Express;
  runtime: ServerRuntime;
}): void {
  const { verifier, oauthTokens, oauthRateLimiter } = runtime;

  app.get("/.well-known/oauth-authorization-server", (req: Request, res: Response) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({
      issuer: baseUrl,
      token_endpoint: `${baseUrl}/oauth/token`,
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      grant_types_supported: ["client_credentials"],
      response_types_supported: [],
      scopes_supported: ["mcp:tools"],
    });
  });

  // RFC 6749 requires application/x-www-form-urlencoded on the token endpoint.
  app.post(
    "/oauth/token",
    express.urlencoded({ extended: false }),
    async (req: Request, res: Response) => {
      const ip = rateLimitKey(req);
      if (oauthRateLimiter.isBlocked(ip)) {
        res.status(429).json({ error: "Too many requests" });
        return;
      }
      oauthRateLimiter.track(ip);

      if (req.body.grant_type !== "client_credentials") {
        res.status(400).json({
          error: "unsupported_grant_type",
          error_description: "Only client_credentials grant type is supported",
        });
        return;
      }

      // client_secret carries the LangWatch API key. client_id is ignored,
      // the API key identifies the project.
      const clientSecret = req.body.client_secret;
      if (!clientSecret || typeof clientSecret !== "string") {
        res.status(400).json({
          error: "invalid_request",
          error_description: "client_secret is required (use your LangWatch API key)",
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
      admitOAuthToken({
        apiKey: clientSecret,
        tokens: oauthTokens,
        maxPerKey: MAX_OAUTH_TOKENS_PER_KEY,
      });
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
    },
  );
}

/** Streamable HTTP transport, the modern MCP transport. */
function registerStreamableHttpRoutes({
  app,
  runtime,
  authenticate,
}: {
  app: express.Express;
  runtime: ServerRuntime;
  authenticate: Authenticate;
}): void {
  const { sessions, sseSessions } = runtime;

  const sessionIdOf = (req: Request): string | undefined =>
    req.headers["mcp-session-id"] as string | undefined;

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = sessionIdOf(req);
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (sessionId && session) {
      const apiKey = await authenticate({
        req,
        res,
        expectedApiKey: session.apiKey,
      });
      if (!apiKey) return;

      sessions.touch(sessionId);
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleRequest(req, res, req.body),
      );
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const apiKey = await authenticate({ req, res });
      if (!apiKey) return;

      if (overSessionLimit({ apiKey, sessions, sseSessions })) {
        sendSessionLimitReached(res);
        return;
      }

      // Claimed before the first await. The session id only exists once
      // initialize completes, so without holding the slot from here concurrent
      // requests for one key would all pass the check above at a count of zero.
      const reservation = sessions.reserve(apiKey);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          reservation.commit({ sessionId: id, transport });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.remove(transport.sessionId);
      };

      const sessionServer = createMcpServer();
      try {
        await handleWithSessionConfig(apiKey, () => sessionServer.connect(transport));
        await handleWithSessionConfig(apiKey, () =>
          transport.handleRequest(req, res, req.body),
        );
      } catch (error) {
        if (transport.sessionId) sessions.remove(transport.sessionId);
        await transport.close().catch(() => undefined);
        throw error;
      } finally {
        // A no-op once the session took the slot, so this only returns it when
        // initialization never produced one.
        reservation.release();
      }
      return;
    }

    // An unknown session id gets the same answer as a missing token, so the
    // response does not reveal whether the session exists.
    if (sessionId) {
      sendUnauthorized({ res, error: "Session expired or not found" });
      return;
    }

    res.status(400).json({
      error: "Invalid request, no session ID or not an initialize request",
    });
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = sessionIdOf(req);
    const session = sessionId ? sessions.get(sessionId) : undefined;

    if (sessionId && session) {
      const apiKey = await authenticate({
        req,
        res,
        expectedApiKey: session.apiKey,
      });
      if (!apiKey) return;

      sessions.touch(sessionId);
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleRequest(req, res),
      );
      return;
    }

    if (sessionId) {
      sendUnauthorized({ res, error: "Session expired or not found" });
      return;
    }

    res.status(400).json({ error: "Invalid request, no valid session ID" });
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    // Authenticate before looking the session up, so that a session the caller
    // does not own is indistinguishable from one that does not exist.
    const apiKey = await authenticate({ req, res });
    if (!apiKey) return;

    const sessionId = sessionIdOf(req);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    const owned =
      session !== undefined &&
      apiKeysMatch({ presentedKey: apiKey, expectedKey: session.apiKey });

    if (!sessionId || !session || !owned) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    sessions.remove(sessionId);
    await session.transport.close();
    res.status(200).json({ status: "session closed" });
  });
}

/** Legacy SSE transport, kept for backwards compatibility. */
function registerSseRoutes({
  app,
  runtime,
  authenticate,
}: {
  app: express.Express;
  runtime: ServerRuntime;
  authenticate: Authenticate;
}): void {
  const { sessions, sseSessions } = runtime;

  app.get("/sse", async (req: Request, res: Response) => {
    const apiKey = await authenticate({ req, res });
    if (!apiKey) return;

    if (overSessionLimit({ apiKey, sessions, sseSessions })) {
      sendSessionLimitReached(res);
      return;
    }

    const transport = new SSEServerTransport("/messages", res);
    sseSessions.add({ sessionId: transport.sessionId, transport, apiKey });

    const sessionServer = createMcpServer();

    res.on("close", () => {
      sseSessions.remove(transport.sessionId);
    });

    try {
      await handleWithSessionConfig(apiKey, () => sessionServer.connect(transport));
    } catch (error) {
      // Without this the entry holds one of the per-key slots until the reaper
      // sweeps it, because res "close" may never fire if the stream never
      // opened.
      sseSessions.remove(transport.sessionId);
      await transport.close().catch(() => undefined);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to open SSE session" });
      }
      throw error;
    }
  });

  // Mounted at both /messages and /sse/messages because some clients resolve
  // the relative /messages URL differently.
  //
  // The session id travels in the query string because the SSE transport hands
  // the client its POST endpoint as a URI. It identifies the session and
  // nothing more: the Bearer token is what authorizes the request.
  const handleSseMessage = async (req: Request, res: Response) => {
    const apiKey = await authenticate({ req, res });
    if (!apiKey) return;

    const sessionId = req.query["sessionId"] as string | undefined;
    const session = sessionId ? sseSessions.get(sessionId) : undefined;
    const owned =
      session !== undefined &&
      apiKeysMatch({ presentedKey: apiKey, expectedKey: session.apiKey });

    if (!sessionId || !session || !owned) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }

    sseSessions.touch(sessionId);
    await handleWithSessionConfig(session.apiKey, () =>
      session.transport.handlePostMessage(req, res, req.body),
    );
  };

  app.post("/messages", handleSseMessage);
  app.post("/sse/messages", handleSseMessage);
}

/** Sweeps idle sessions, expired tokens, and stale rate limiter entries. */
function startReaper(runtime: ServerRuntime): NodeJS.Timeout {
  const {
    sessions,
    sseSessions,
    oauthTokens,
    verifier,
    authFailRateLimiter,
    oauthRateLimiter,
  } = runtime;

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
  return reaper;
}

function createRuntime({
  endpoint,
  apiKeyVerifier,
}: {
  endpoint: string;
  apiKeyVerifier?: ApiKeyVerifier;
}): ServerRuntime {
  const closeTransport = (transport: { close(): Promise<void> }) =>
    void transport.close().catch(() => undefined);

  return {
    verifier: apiKeyVerifier ?? createApiKeyVerifier({ endpoint }),
    oauthTokens: new Map<string, OAuthTokenEntry>(),
    // Failed authentication is rate limited per client address so an attacker
    // cannot spray candidate keys or turn one flood into unbounded
    // verification traffic upstream.
    authFailRateLimiter: createRateLimiter({
      windowMs: 60_000,
      maxRequests: 20,
    }),
    oauthRateLimiter: createRateLimiter({ windowMs: 60_000, maxRequests: 10 }),
    sessions: createSessionStore<StreamableHTTPServerTransport>({
      maxAgeMs: SESSION_MAX_AGE_MS,
      closeTransport,
    }),
    sseSessions: createSessionStore<SSEServerTransport>({
      maxAgeMs: SESSION_MAX_AGE_MS,
      closeTransport,
    }),
  };
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
  const bindHost = host ?? process.env.LANGWATCH_MCP_HTTP_HOST ?? DEFAULT_BIND_HOST;
  const originAllowlist =
    allowedOrigins ?? parseAllowedOrigins(process.env.LANGWATCH_MCP_ALLOWED_ORIGINS);

  const runtime = createRuntime({
    endpoint: getConfig().endpoint,
    apiKeyVerifier,
  });
  const authenticate = createAuthenticator(runtime);
  const reaper = startReaper(runtime);

  const app = express();
  // Forwarded headers carry the external scheme that the OAuth metadata
  // document advertises. They do not decide the rate limit key; see
  // rateLimitKey().
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(createOriginMiddleware({ allowedOrigins: originAllowlist }));

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  registerOAuthRoutes({ app, runtime });
  registerStreamableHttpRoutes({ app, runtime, authenticate });
  registerSseRoutes({ app, runtime, authenticate });

  return new Promise((resolve) => {
    const server = app.listen(port, bindHost, () => {
      const addr = server.address();
      const resolvedPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server,
        port: resolvedPort,
        host: bindHost,
        allowedOrigins: originAllowlist,
      });
    });

    server.on("close", () => {
      clearInterval(reaper);
      runtime.sessions.closeAll();
      runtime.sseSessions.closeAll();
    });
  });
}
