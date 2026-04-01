/**
 * @vitest-environment node
 *
 * Integration tests for the in-app MCP HTTP handler.
 * Tests route reachability, auth flow, CORS, health, and token validation.
 *
 * The handler is tested by creating a real HTTP server (no Express) with
 * mocked Prisma and Redis dependencies.
 */
import { createServer, type Server } from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { McpHandler } from "../handler";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  project: {
    findUnique: vi.fn(),
  },
};

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

vi.mock("~/server/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("~/server/redis", () => ({
  connection: mockRedis,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_API_KEY = "lw_test_key_123";
const PROJECT_ID = "test-project-id";

function validProject() {
  return {
    id: PROJECT_ID,
    apiKey: VALID_API_KEY,
    teamId: "team-1",
    name: "Test Project",
    archivedAt: null,
    team: { id: "team-1", organizationId: "org-1" },
  };
}

function mcpInitializeBody() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };
}

/**
 * Parses an SSE stream body to extract JSON data lines.
 * SSE format: "event: message\ndata: {...}\n\n"
 */
function parseSseBody(raw: string): unknown[] {
  const results: unknown[] = [];
  const lines = raw.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        results.push(JSON.parse(line.slice(6)));
      } catch {
        // skip non-JSON data lines
      }
    }
  }
  return results;
}

async function sendRequest({
  server,
  method = "POST",
  path = "/mcp",
  body,
  headers = {},
}: {
  server: Server;
  method?: string;
  path?: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Parsed JSON body — from JSON response or first SSE data line. */
  json: () => unknown;
}> {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}${path}`;

  const fetchHeaders: Record<string, string> = { ...headers };
  if (body && !fetchHeaders["content-type"]) {
    fetchHeaders["content-type"] = "application/json";
  }
  // MCP Streamable HTTP requires Accept header for POST/GET on /mcp
  if (
    path === "/mcp" &&
    (method === "POST" || method === "GET") &&
    !fetchHeaders["accept"]
  ) {
    fetchHeaders["accept"] = "text/event-stream, application/json";
  }

  const res = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const rawBody = await res.text();

  return {
    status: res.status,
    headers: responseHeaders,
    body: rawBody,
    json: () => {
      const contentType = responseHeaders["content-type"] ?? "";
      if (contentType.includes("text/event-stream")) {
        const parsed = parseSseBody(rawBody);
        return parsed[0]; // Return first JSON-RPC response
      }
      return JSON.parse(rawBody);
    },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Feature: MCP HTTP Server In-App Integration", () => {
  let server: Server;
  let handler: McpHandler;

  beforeAll(async () => {
    const { createMcpHandler } = await import("../handler");
    handler = createMcpHandler();

    server = createServer((req, res) => {
      handler.handleRequest(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
  });

  afterAll(async () => {
    handler.closeAllSessions();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
  });

  // --- Route Mounting ---

  describe("when Streamable HTTP transport is accessed at /mcp", () => {
    it("responds with 200 and mcp-session-id header", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const res = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });

      expect(res.status).toBe(200);
      expect(res.headers["mcp-session-id"]).toBeDefined();
    });
  });

  describe("when GET /mcp/health is requested without credentials", () => {
    it("responds with 200 and status ok", async () => {
      const res = await sendRequest({
        server,
        method: "GET",
        path: "/mcp/health",
      });

      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe("ok");
    });
  });

  describe("when a non-MCP route is requested", () => {
    it("is not intercepted by the MCP handler", async () => {
      const res = await sendRequest({
        server,
        method: "GET",
        path: "/api/health",
      });
      // The handler returns 404 for unknown routes, proving /api/health
      // is not matched as an MCP route. In production, start.ts checks
      // isMcpRoute() first and falls through to Next.js.
      expect(res.status).toBe(404);
    });
  });

  describe("when MCP POST request body is sent", () => {
    it("returns a valid initialize result", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const res = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });

      expect(res.status).toBe(200);
      const body = res.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      expect(result).toBeDefined();
      expect(result.protocolVersion).toBeDefined();
      const serverInfo = result.serverInfo as Record<string, unknown>;
      expect(serverInfo).toBeDefined();
      expect(serverInfo.name).toBe("LangWatch");
    });
  });

  // --- OAuth client_credentials ---

  describe("when OAuth metadata is fetched", () => {
    it("advertises client_credentials grant", async () => {
      const res = await sendRequest({
        server,
        method: "GET",
        path: "/.well-known/oauth-authorization-server",
      });

      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.grant_types_supported).toContain("client_credentials");
      expect(body.token_endpoint).toContain("/oauth/token");
    });
  });

  describe("when client_credentials grant is used with valid API key", () => {
    it("issues an access token", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_secret=${VALID_API_KEY}`,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe("Bearer");
    });
  });

  describe("when client_credentials grant is missing client_secret", () => {
    it("returns 400 with invalid_request error", async () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_request");
    });
  });

  // --- Bearer Token DB Validation ---

  describe("when a direct API key is used as Bearer token", () => {
    it("validates against the database and accepts the connection", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const res = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });

      expect(res.status).toBe(200);
      expect(mockPrisma.project.findUnique).toHaveBeenCalledWith({
        where: { apiKey: VALID_API_KEY, archivedAt: null },
      });
    });
  });

  describe("when an invalid Bearer token is used", () => {
    it("returns 401", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);

      const res = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: "Bearer lw_fake_key_999" },
      });

      expect(res.status).toBe(401);
    });
  });

  describe("when an OAuth-issued access token is used", () => {
    it("authenticates MCP requests", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      // First, obtain an access token
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const tokenRes = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_secret=${VALID_API_KEY}`,
      });
      const tokenBody = await tokenRes.json();
      const accessToken = tokenBody.access_token;

      // Use the access token to initialize MCP
      const res = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(200);
      expect(res.headers["mcp-session-id"]).toBeDefined();
    });
  });

  // --- Redis Token Storage ---

  describe("when OAuth token is looked up from Redis after in-memory cache miss", () => {
    it("accepts the connection via Redis lookup", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      // Issue a token (this stores it in both memory and Redis mock)
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const tokenRes = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_secret=${VALID_API_KEY}`,
      });
      const tokenBody = await tokenRes.json();
      const accessToken = tokenBody.access_token;

      // Clear in-memory cache
      handler.clearTokenCache();

      // Mock Redis to return the token data
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          apiKey: VALID_API_KEY,
          expiresAt: Date.now() + 3600 * 1000,
        }),
      );

      // Use the access token - should fall back to Redis
      const res = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(200);
      expect(mockRedis.get).toHaveBeenCalled();
    });
  });

  describe("when an expired OAuth token is used", () => {
    it("returns 401", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);

      // Mock Redis returning an expired token
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          apiKey: VALID_API_KEY,
          expiresAt: Date.now() - 1000, // expired
        }),
      );

      const res = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: "Bearer expired_token_abc" },
      });

      expect(res.status).toBe(401);
    });
  });

  // --- CORS ---

  describe("when a request to /mcp includes an Origin header", () => {
    it("includes CORS headers in the response", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const res = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          origin: "https://example.com",
        },
      });

      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["access-control-allow-headers"]).toContain(
        "Authorization",
      );
      expect(res.headers["access-control-allow-headers"]).toContain(
        "mcp-session-id",
      );
    });
  });

  describe("when an OPTIONS preflight request is sent to /mcp", () => {
    it("responds with 200 and CORS headers", async () => {
      const res = await sendRequest({
        server,
        method: "OPTIONS",
        path: "/mcp",
      });

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe("*");
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
      expect(res.headers["access-control-allow-methods"]).toContain("GET");
      expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
    });
  });

  // --- Standalone Package Isolation ---

  describe("when the standalone mcp-server package is checked for isolation", () => {
    it("does not import any main app modules", async () => {
      // The mcp-server package's create-mcp-server.ts should not import
      // from the main app (~/server/db, ~/server/redis, etc.)
      const fs = await import("node:fs");
      const path = await import("node:path");
      const mcpServerDir = path.resolve(__dirname, "../../../../mcp-server/src");
      const createMcpServerSrc = fs.readFileSync(
        path.join(mcpServerDir, "create-mcp-server.ts"),
        "utf-8"
      );
      // Should not import from the main app
      expect(createMcpServerSrc).not.toContain("~/server/");
      expect(createMcpServerSrc).not.toContain("../server/");
      expect(createMcpServerSrc).not.toContain("langwatch/src/");
    });
  });

  // --- Tool Availability ---

  describe("when a client lists available tools via /mcp", () => {
    it("includes observability, platform, and documentation tools", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      // First, initialize a session
      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });

      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers["mcp-session-id"]!;

      // Send initialized notification
      await sendRequest({
        server,
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "mcp-session-id": sessionId,
        },
      });

      // List tools
      const toolsRes = await sendRequest({
        server,
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "mcp-session-id": sessionId,
        },
      });

      expect(toolsRes.status).toBe(200);
      const toolsBody = toolsRes.json() as Record<string, unknown>;
      const result = toolsBody.result as Record<string, unknown>;
      const tools = result.tools as Array<{ name: string }>;
      const toolNames = tools.map((t) => t.name);

      // Observability tools
      expect(toolNames).toContain("search_traces");
      expect(toolNames).toContain("get_analytics");
      // Platform tools
      expect(toolNames).toContain("platform_list_prompts");
      expect(toolNames).toContain("platform_create_scenario");
      // Documentation tools
      expect(toolNames).toContain("fetch_langwatch_docs");
      expect(toolNames).toContain("fetch_scenario_docs");
    });
  });
});
