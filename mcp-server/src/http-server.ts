import express from "express";
import type { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID, createHash } from "node:crypto";
import type { Server } from "node:http";

import { getConfig, runWithConfig } from "./config.js";
import { createMcpServer } from "./create-mcp-server.js";

/**
 * In-memory store for OAuth access tokens.
 * Maps token → API key so we can resolve Bearer tokens from either
 * direct API keys or OAuth-issued access tokens.
 */
const oauthTokens = new Map<string, { apiKey: string; expiresAt: number }>();

/**
 * Extracts the API key from the request's Authorization header.
 * Accepts both direct API keys and OAuth-issued access tokens.
 * Expects the format: `Bearer <key>`.
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7) || null;
  if (!token) return null;

  // Check if this is an OAuth-issued access token
  const oauthEntry = oauthTokens.get(token);
  if (oauthEntry) {
    if (Date.now() < oauthEntry.expiresAt) {
      return oauthEntry.apiKey;
    }
    // Token expired, clean up
    oauthTokens.delete(token);
    return null;
  }

  // Otherwise treat it as a direct API key
  return token;
}

/**
 * Generates a deterministic but opaque access token from client credentials.
 */
function generateAccessToken(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

/**
 * Per-session state: the transport and the API key provided at session creation.
 */
interface SessionState {
  transport: StreamableHTTPServerTransport;
  apiKey: string;
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

/**
 * Starts an Express HTTP server with Streamable HTTP and legacy SSE transports
 * for the LangWatch MCP server.
 *
 * Each client session provides its own API key via `Authorization: Bearer <key>`.
 * The key is captured on the initialize request and stored per-session. All
 * subsequent requests in that session use the captured key.
 *
 * Endpoints:
 * - GET /health - Health check for Kubernetes probes (no auth)
 * - POST/GET/DELETE /mcp - Streamable HTTP transport (modern)
 * - GET /sse - Legacy SSE transport (backwards compatibility)
 * - POST /messages - Legacy SSE message endpoint
 */
export async function startHttpServer({
  port,
}: {
  port: number;
}): Promise<{ server: Server; port: number }> {
  const app = express();
  app.use(express.json());

  // CORS middleware for cross-origin requests (ChatGPT/Claude Chat)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS"
    );
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, mcp-session-id, MCP-Protocol-Version"
    );
    if (_req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Health check endpoint for Kubernetes probes
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

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
    (req: Request, res: Response) => {
      const grantType =
        req.body.grant_type ?? req.query["grant_type"];

      if (grantType !== "client_credentials") {
        res.status(400).json({
          error: "unsupported_grant_type",
          error_description:
            "Only client_credentials grant type is supported",
        });
        return;
      }

      // Accept client_secret as the LangWatch API key.
      // client_id is ignored — the API key identifies the project.
      const clientSecret =
        req.body.client_secret ?? req.query["client_secret"];

      if (!clientSecret) {
        res.status(400).json({
          error: "invalid_request",
          error_description:
            "client_secret is required (use your LangWatch API key)",
        });
        return;
      }

      const expiresIn = 3600; // 1 hour
      const accessToken = generateAccessToken();

      oauthTokens.set(accessToken, {
        apiKey: clientSecret as string,
        expiresAt: Date.now() + expiresIn * 1000,
      });

      res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: expiresIn,
        scope: "mcp:tools",
      });
    }
  );

  // --- Streamable HTTP transport (modern) ---

  const sessions: Record<string, SessionState> = {};

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleRequest(req, res, req.body)
      );
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const apiKey = extractBearerToken(req);

      if (!apiKey) {
        res.status(401).json({
          error:
            "Authorization: Bearer <LANGWATCH_API_KEY> header required",
        });
        return;
      }

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
        sessionServer.connect(transport)
      );

      await handleWithSessionConfig(apiKey, () =>
        transport.handleRequest(req, res, req.body)
      );
      return;
    }

    res.status(400).json({
      error: "Invalid request — no session ID or not an initialize request",
    });
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      await handleWithSessionConfig(session.apiKey, () =>
        session.transport.handleRequest(req, res)
      );
    } else {
      res
        .status(400)
        .json({ error: "Invalid request — no valid session ID" });
    }
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions[sessionId]) {
      const session = sessions[sessionId];
      await session.transport.close();
      delete sessions[sessionId];
      res.status(200).json({ status: "session closed" });
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  });

  // --- Legacy SSE transport (backwards compatibility) ---

  interface SseSessionState {
    transport: SSEServerTransport;
    apiKey: string;
  }

  const sseSessions: Record<string, SseSessionState> = {};

  app.get("/sse", async (req: Request, res: Response) => {
    const apiKey =
      extractBearerToken(req) ||
      (req.query["apiKey"] as string | undefined) ||
      null;

    if (!apiKey) {
      res.status(401).json({
        error:
          "Authorization: Bearer <LANGWATCH_API_KEY> header or ?apiKey= query parameter required",
      });
      return;
    }

    const transport = new SSEServerTransport("/messages", res);
    sseSessions[transport.sessionId] = { transport, apiKey };

    const sessionServer = createMcpServer();

    // Clean up when the SSE connection closes
    res.on("close", () => {
      delete sseSessions[transport.sessionId];
    });

    await handleWithSessionConfig(apiKey, () =>
      sessionServer.connect(transport)
    );
  });

  // Handle POST messages — mount at both /messages and /sse/messages
  // because some clients resolve the relative /messages URL differently
  const handleSseMessage = async (req: Request, res: Response) => {
    const sessionId = req.query["sessionId"] as string | undefined;
    if (!sessionId || !sseSessions[sessionId]) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }

    const session = sseSessions[sessionId];
    await handleWithSessionConfig(session.apiKey, () =>
      session.transport.handlePostMessage(req, res, req.body)
    );
  };

  app.post("/messages", handleSseMessage);
  app.post("/sse/messages", handleSseMessage);

  // Start the server
  return new Promise((resolve) => {
    const server = app.listen(port, "0.0.0.0", () => {
      const addr = server.address();
      const resolvedPort =
        typeof addr === "object" && addr ? addr.port : port;
      resolve({ server, port: resolvedPort });
    });
  });
}
