import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initConfig } from "../config.js";
import type { Server } from "http";

/** Standard headers required by the MCP Streamable HTTP protocol for POST requests */
const MCP_POST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

const BEARER_TOKEN = "test-session-key";

/** Helper to create auth + MCP headers */
function mcpHeaders({
  sessionId,
  apiKey,
}: { sessionId?: string; apiKey?: string } = {}) {
  const headers: Record<string, string> = {
    ...MCP_POST_HEADERS,
    Authorization: `Bearer ${apiKey ?? BEARER_TOKEN}`,
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }
  return headers;
}

function initializeBody() {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
    id: 1,
  });
}

describe("HTTP transport", () => {
  let httpServer: Server;
  let port: number;

  beforeAll(async () => {
    // Initialize with no API key -- HTTP mode relies on per-session Bearer tokens
    initConfig({
      endpoint: "https://app.langwatch.ai",
    });

    const { startHttpServer } = await import("../http-server.js");
    const result = await startHttpServer({ port: 0 });
    httpServer = result.server;
    port = result.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  describe("/health endpoint", () => {
    it("returns ok status without authentication", async () => {
      const response = await fetch(`http://localhost:${port}/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ status: "ok" });
    });
  });

  describe("CORS headers", () => {
    it("includes Access-Control-Allow-Origin on responses", async () => {
      const response = await fetch(`http://localhost:${port}/health`);

      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("responds to OPTIONS preflight requests", async () => {
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "OPTIONS",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-methods")).toContain(
        "POST"
      );
      expect(response.headers.get("access-control-allow-headers")).toContain(
        "mcp-session-id"
      );
    });

    it("includes Authorization in allowed headers for CORS", async () => {
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "OPTIONS",
      });

      expect(response.headers.get("access-control-allow-headers")).toContain(
        "Authorization"
      );
    });
  });

  describe("/mcp endpoint (Streamable HTTP)", () => {
    describe("when no Bearer token is provided", () => {
      it("returns 401 on initialize request", async () => {
        const response = await fetch(`http://localhost:${port}/mcp`, {
          method: "POST",
          headers: MCP_POST_HEADERS,
          body: initializeBody(),
        });

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error).toContain("Authorization");
      });
    });

    it("rejects non-initialize POST without session ID", async () => {
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_POST_HEADERS,
          Authorization: `Bearer ${BEARER_TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });

      expect(response.status).toBe(400);
    });

    it("accepts initialize request with Bearer token and returns session ID", async () => {
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: mcpHeaders(),
        body: initializeBody(),
      });

      expect(response.status).toBe(200);
      const sessionId = response.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
    });

    it("lists all tools after initialization", async () => {
      const initResponse = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: mcpHeaders(),
        body: initializeBody(),
      });

      const sessionId = initResponse.headers.get("mcp-session-id")!;

      // Send initialized notification
      await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: mcpHeaders({ sessionId }),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      });

      // List tools
      const toolsResponse = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: mcpHeaders({ sessionId }),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 2,
        }),
      });

      expect(toolsResponse.status).toBe(200);
      const text = await toolsResponse.text();
      expect(text).toContain("fetch_langwatch_docs");
      expect(text).toContain("discover_schema");
      expect(text).toContain("search_traces");
      expect(text).toContain("platform_create_prompt");
    });
  });

  describe("DELETE /mcp", () => {
    it("closes an existing session", async () => {
      const initResponse = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: mcpHeaders(),
        body: initializeBody(),
      });

      const sessionId = initResponse.headers.get("mcp-session-id")!;

      const deleteResponse = await fetch(`http://localhost:${port}/mcp`, {
        method: "DELETE",
        headers: { "mcp-session-id": sessionId },
      });

      expect(deleteResponse.status).toBe(200);
    });

    it("returns 404 for unknown session", async () => {
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "DELETE",
        headers: { "mcp-session-id": "nonexistent-session-id" },
      });

      expect(response.status).toBe(404);
    });
  });

  describe("OAuth 2.0 endpoints", () => {
    describe("/.well-known/oauth-authorization-server", () => {
      it("returns OAuth metadata with token endpoint", async () => {
        const response = await fetch(
          `http://localhost:${port}/.well-known/oauth-authorization-server`
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.token_endpoint).toContain("/oauth/token");
        expect(body.grant_types_supported).toContain("client_credentials");
      });
    });

    describe("/oauth/token", () => {
      it("returns 400 for unsupported grant type", async () => {
        const response = await fetch(
          `http://localhost:${port}/oauth/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "grant_type=authorization_code&client_secret=test-key",
          }
        );
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe("unsupported_grant_type");
      });

      it("returns 400 when client_secret is missing", async () => {
        const response = await fetch(
          `http://localhost:${port}/oauth/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "grant_type=client_credentials",
          }
        );
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe("invalid_request");
      });

      it("issues an access token for valid client credentials", async () => {
        const response = await fetch(
          `http://localhost:${port}/oauth/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "grant_type=client_credentials&client_secret=my-langwatch-api-key",
          }
        );
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.access_token).toBeTruthy();
        expect(body.token_type).toBe("Bearer");
        expect(body.expires_in).toBe(3600);
      });

      it("issued token works for MCP initialize request", async () => {
        // Get OAuth token
        const tokenResponse = await fetch(
          `http://localhost:${port}/oauth/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `grant_type=client_credentials&client_secret=${BEARER_TOKEN}`,
          }
        );
        const { access_token } = await tokenResponse.json();

        // Use OAuth token for MCP initialize
        const response = await fetch(`http://localhost:${port}/mcp`, {
          method: "POST",
          headers: {
            ...MCP_POST_HEADERS,
            Authorization: `Bearer ${access_token}`,
          },
          body: initializeBody(),
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("mcp-session-id")).toBeTruthy();
      });

      it("issued token works for SSE connection", async () => {
        const controller = new AbortController();

        // Get OAuth token
        const tokenResponse = await fetch(
          `http://localhost:${port}/oauth/token`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `grant_type=client_credentials&client_secret=${BEARER_TOKEN}`,
          }
        );
        const { access_token } = await tokenResponse.json();

        // Use OAuth token for SSE
        const response = await fetch(`http://localhost:${port}/sse`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${access_token}` },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "text/event-stream"
        );

        controller.abort();
      });
    });
  });

  describe("/sse endpoint (legacy SSE)", () => {
    it("returns 401 without authorization", async () => {
      const controller = new AbortController();

      const response = await fetch(`http://localhost:${port}/sse`, {
        signal: controller.signal,
      });

      expect(response.status).toBe(401);
      controller.abort();
    });

    it("establishes SSE connection with Bearer token in header", async () => {
      const controller = new AbortController();

      const response = await fetch(`http://localhost:${port}/sse`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream"
      );

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader.read();
      const text = decoder.decode(value);

      expect(text).toContain("event: endpoint");
      expect(text).toContain("/messages?sessionId=");

      controller.abort();
    });

    it("establishes SSE connection with apiKey query parameter", async () => {
      const controller = new AbortController();

      const response = await fetch(
        `http://localhost:${port}/sse?apiKey=${BEARER_TOKEN}`,
        { signal: controller.signal }
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream"
      );

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader.read();
      const text = decoder.decode(value);

      expect(text).toContain("event: endpoint");

      controller.abort();
    });
  });
});
