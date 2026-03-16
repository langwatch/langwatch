import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initConfig } from "../config.js";
import type { Server } from "http";

/** Standard headers required by the MCP Streamable HTTP protocol for POST requests */
const MCP_POST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

describe("HTTP transport", () => {
  let httpServer: Server;
  let port: number;

  beforeAll(async () => {
    initConfig({
      apiKey: "test-key",
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
    it("returns ok status", async () => {
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
  });

  describe("/mcp endpoint (Streamable HTTP)", () => {
    it("rejects non-initialize POST without session ID", async () => {
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: MCP_POST_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 1,
        }),
      });

      expect(response.status).toBe(400);
    });

    it("accepts initialize request and returns session ID", async () => {
      const response = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: MCP_POST_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
          id: 1,
        }),
      });

      expect(response.status).toBe(200);
      const sessionId = response.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
    });

    it("lists all tools after initialization", async () => {
      // Step 1: Initialize to get session ID
      const initResponse = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: MCP_POST_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
          id: 1,
        }),
      });

      const sessionId = initResponse.headers.get("mcp-session-id")!;

      // Step 2: Send initialized notification
      await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_POST_HEADERS,
          "mcp-session-id": sessionId,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      });

      // Step 3: List tools
      const toolsResponse = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_POST_HEADERS,
          "mcp-session-id": sessionId,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/list",
          id: 2,
        }),
      });

      expect(toolsResponse.status).toBe(200);
      const text = await toolsResponse.text();
      // The response may be SSE or JSON depending on transport
      expect(text).toContain("fetch_langwatch_docs");
      expect(text).toContain("discover_schema");
      expect(text).toContain("search_traces");
      expect(text).toContain("platform_create_prompt");
    });
  });

  describe("DELETE /mcp", () => {
    it("closes an existing session", async () => {
      // Initialize
      const initResponse = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: MCP_POST_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test-client", version: "1.0.0" },
          },
          id: 1,
        }),
      });

      const sessionId = initResponse.headers.get("mcp-session-id")!;

      // Delete session
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

  describe("/sse endpoint (legacy SSE)", () => {
    it("establishes SSE connection and sends endpoint event", async () => {
      const controller = new AbortController();

      const response = await fetch(`http://localhost:${port}/sse`, {
        signal: controller.signal,
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream"
      );

      // Read the first event from the SSE stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const { value } = await reader.read();
      const text = decoder.decode(value);

      expect(text).toContain("event: endpoint");
      expect(text).toContain("/messages?sessionId=");

      controller.abort();
    });
  });
});
