import express from "express";
import type { Request, Response, NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { createMcpServer } from "./create-mcp-server.js";

/**
 * Starts an Express HTTP server with Streamable HTTP and legacy SSE transports
 * for the LangWatch MCP server.
 *
 * Endpoints:
 * - GET /health - Health check for Kubernetes probes
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
      "Content-Type, mcp-session-id, MCP-Protocol-Version"
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

  const streamableTransports: Record<string, StreamableHTTPServerTransport> =
    {};

  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    let transport: StreamableHTTPServerTransport;

    if (sessionId && streamableTransports[sessionId]) {
      transport = streamableTransports[sessionId];
    } else if (
      !sessionId &&
      isInitializeRequest(req.body)
    ) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          streamableTransports[id] = transport;
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          delete streamableTransports[transport.sessionId];
        }
      };

      const sessionServer = createMcpServer();
      await sessionServer.connect(transport);
    } else {
      res
        .status(400)
        .json({
          error:
            "Invalid request — no session ID or not an initialize request",
        });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && streamableTransports[sessionId]) {
      const transport = streamableTransports[sessionId];
      await transport.handleRequest(req, res);
    } else {
      res
        .status(400)
        .json({ error: "Invalid request — no valid session ID" });
    }
  });

  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId && streamableTransports[sessionId]) {
      const transport = streamableTransports[sessionId];
      await transport.close();
      delete streamableTransports[sessionId];
      res.status(200).json({ status: "session closed" });
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  });

  // --- Legacy SSE transport (backwards compatibility) ---

  const sseTransports: Record<string, SSEServerTransport> = {};

  app.get("/sse", async (req: Request, res: Response) => {
    const transport = new SSEServerTransport("/messages", res);
    sseTransports[transport.sessionId] = transport;

    const sessionServer = createMcpServer();

    // Clean up when the SSE connection closes
    res.on("close", () => {
      delete sseTransports[transport.sessionId];
    });

    await sessionServer.connect(transport);
  });

  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query["sessionId"] as string | undefined;
    if (!sessionId || !sseTransports[sessionId]) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }

    const transport = sseTransports[sessionId];
    await transport.handlePostMessage(req, res, req.body);
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
