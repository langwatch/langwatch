import express from "express";
import type { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { getConfig, runWithConfig } from "./config.js";
import { createMcpServer } from "./create-mcp-server.js";

/**
 * Extracts the API key from the request's Authorization header.
 * Expects the format: `Bearer <key>`.
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7) || null;
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

  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query["sessionId"] as string | undefined;
    if (!sessionId || !sseSessions[sessionId]) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }

    const session = sseSessions[sessionId];
    await handleWithSessionConfig(session.apiKey, () =>
      session.transport.handlePostMessage(req, res, req.body)
    );
  });

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
