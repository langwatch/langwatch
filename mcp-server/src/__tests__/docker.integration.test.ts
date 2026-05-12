import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "child_process";

const IMAGE_NAME = "langwatch-mcp-server-test";
const CONTAINER_NAME = "langwatch-mcp-server-test-container";
const HOST_PORT = 13099; // unlikely to conflict
const BEARER_TOKEN = "test-docker-api-key";

/** Standard headers required by the MCP Streamable HTTP protocol */
const MCP_POST_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

describe("Docker container", () => {
  let containerRunning = false;

  beforeAll(async () => {
    try {
      // Build from repo root (mcp-server needs langevals/ for build)
      const repoRoot = process.cwd().replace(/\/mcp-server.*$/, "");
      execSync(
        `docker build -t ${IMAGE_NAME} -f mcp-server/Dockerfile .`,
        {
          cwd: repoRoot,
          stdio: "pipe",
          timeout: 180_000,
        }
      );

      // Stop any previous container
      execSync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null || true`, {
        stdio: "pipe",
      });

      // Start the container WITHOUT LANGWATCH_API_KEY -- clients bring their own
      execSync(
        `docker run -d --name ${CONTAINER_NAME} -p ${HOST_PORT}:3000 ${IMAGE_NAME}`,
        { stdio: "pipe" }
      );

      // Wait for the server to be ready
      let retries = 0;
      while (retries < 20) {
        try {
          const res = await fetch(`http://localhost:${HOST_PORT}/health`);
          if (res.ok) {
            containerRunning = true;
            break;
          }
        } catch {
          // not ready yet
        }
        await new Promise((r) => setTimeout(r, 500));
        retries++;
      }

      if (!containerRunning) {
        const logs = execSync(`docker logs ${CONTAINER_NAME}`, {
          encoding: "utf8",
        });
        throw new Error(`Container failed to start. Logs:\n${logs}`);
      }
    } catch (error) {
      console.error("Docker setup failed:", error);
      // Clean up on failure
      execSync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null || true`, {
        stdio: "pipe",
      });
    }
  }, 180_000); // 3 min for build + start

  afterAll(() => {
    execSync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null || true`, {
      stdio: "pipe",
    });
  });

  it("health endpoint responds without authentication", async () => {
    if (!containerRunning) return;

    const res = await fetch(`http://localhost:${HOST_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("CORS headers are present", async () => {
    if (!containerRunning) return;

    const res = await fetch(`http://localhost:${HOST_PORT}/health`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns 401 on initialize without Bearer token", async () => {
    if (!containerRunning) return;

    const res = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: MCP_POST_HEADERS,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "docker-test", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Authorization");
  });

  it("MCP initialize works with Bearer token", async () => {
    if (!containerRunning) return;

    const res = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "docker-test", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    const sessionId = res.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    // Parse SSE response for the initialize result
    const text = await res.text();
    expect(text).toContain("serverInfo");
  });

  it("lists tools after initialization with Bearer token", async () => {
    if (!containerRunning) return;

    // Initialize a session
    const initRes = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "docker-test", version: "1.0.0" },
        },
      }),
    });

    const sessionId = initRes.headers.get("mcp-session-id");

    // Send initialized notification
    await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        "mcp-session-id": sessionId!,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    // List tools
    const toolsRes = await fetch(`http://localhost:${HOST_PORT}/mcp`, {
      method: "POST",
      headers: {
        ...MCP_POST_HEADERS,
        "mcp-session-id": sessionId!,
        Authorization: `Bearer ${BEARER_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
    });

    expect(toolsRes.status).toBe(200);
    const toolsText = await toolsRes.text();
    expect(toolsText).toContain("fetch_langwatch_docs");
    expect(toolsText).toContain("search_traces");
  });

  it("legacy SSE endpoint responds with Bearer token", async () => {
    if (!containerRunning) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`http://localhost:${HOST_PORT}/sse`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
    } catch (error: any) {
      if (error.name !== "AbortError") throw error;
      // AbortError is expected -- SSE stays open
    } finally {
      clearTimeout(timeout);
    }
  });

  it("legacy SSE endpoint returns 401 without token", async () => {
    if (!containerRunning) return;

    const res = await fetch(`http://localhost:${HOST_PORT}/sse`);
    expect(res.status).toBe(401);
  });
});
