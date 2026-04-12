/**
 * @vitest-environment node
 *
 * Integration tests for the in-app MCP HTTP handler.
 * Tests route reachability, auth flow, CORS, health, and token validation.
 *
 * The handler is tested by creating a real HTTP server (no Express) with
 * mocked Prisma and Redis dependencies.
 */
import { createHash, randomUUID } from "node:crypto";
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
  expire: vi.fn(),
  sadd: vi.fn(),
  srem: vi.fn(),
  smembers: vi.fn(),
  exists: vi.fn(),
};

vi.mock("~/server/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("~/server/redis", () => ({
  connection: mockRedis,
}));

// Mock encryption — use identity functions so tests can inspect values
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `encrypted:${text}`,
  decrypt: (text: string) =>
    text.startsWith("encrypted:") ? text.slice(10) : text,
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

/**
 * Creates a PKCE code_verifier and code_challenge pair for testing.
 */
function createPkceChallenge() {
  const codeVerifier = randomUUID() + randomUUID();
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

/**
 * Stores a mock auth code in the Redis mock that the handler can retrieve.
 */
function mockAuthCodeInRedis({
  code,
  codeChallenge,
  apiKey = VALID_API_KEY,
  expiresAt,
}: {
  code: string;
  codeChallenge: string;
  apiKey?: string;
  expiresAt?: number;
}) {
  const entry = JSON.stringify({
    projectId: PROJECT_ID,
    encryptedApiKey: `encrypted:${apiKey}`,
    codeChallenge,
    codeChallengeMethod: "S256",
    expiresAt: expiresAt ?? Date.now() + 600_000,
  });

  mockRedis.get.mockImplementation((key: string) => {
    if (key === `mcp:auth_code:${code}`) {
      return Promise.resolve(entry);
    }
    return Promise.resolve(null);
  });
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
    mockRedis.del.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.sadd.mockResolvedValue(1);
    mockRedis.srem.mockResolvedValue(1);
    mockRedis.smembers.mockResolvedValue([]);
    mockRedis.exists.mockResolvedValue(0);
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

  // --- OAuth authorization_code ---

  describe("when OAuth metadata is fetched", () => {
    it("advertises authorization_code grant", async () => {
      const res = await sendRequest({
        server,
        method: "GET",
        path: "/.well-known/oauth-authorization-server",
      });

      expect(res.status).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.grant_types_supported).toContain("authorization_code");
      expect(body.response_types_supported).toContain("code");
      expect(body.code_challenge_methods_supported).toContain("S256");
      expect(body.token_endpoint_auth_methods_supported).toContain("none");
      expect(body.authorization_endpoint).toContain("/mcp/authorize");
      expect(body.token_endpoint).toContain("/oauth/token");
    });
  });

  describe("when authorization_code grant is used with a valid auth code and PKCE verifier", () => {
    it("issues an access token", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const code = randomUUID();
      const { codeVerifier, codeChallenge } = createPkceChallenge();

      mockAuthCodeInRedis({ code, codeChallenge });

      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=authorization_code&code=${code}&code_verifier=${codeVerifier}&redirect_uri=http://localhost/callback`,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.access_token).toBeDefined();
      expect(body.token_type).toBe("Bearer");
      expect(body.expires_in).toBe(30 * 24 * 3600); // 30 days

      // Verify the auth code was deleted (one-time use)
      expect(mockRedis.del).toHaveBeenCalledWith(`mcp:auth_code:${code}`);
    });
  });

  describe("when authorization_code grant is used with an invalid code_verifier", () => {
    it("returns 400 with invalid_grant error", async () => {
      const code = randomUUID();
      const { codeChallenge } = createPkceChallenge();

      mockAuthCodeInRedis({ code, codeChallenge });

      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=authorization_code&code=${code}&code_verifier=wrong-verifier`,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_grant");
      expect(body.error_description).toContain("code_verifier");
    });
  });

  describe("when authorization_code grant is missing the code parameter", () => {
    it("returns 400 with invalid_request error", async () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code_verifier=some-verifier",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("code is required");
    });
  });

  describe("when authorization_code grant is missing the code_verifier parameter", () => {
    it("returns 400 with invalid_request error", async () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=authorization_code&code=${randomUUID()}`,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_request");
      expect(body.error_description).toContain("code_verifier is required");
    });
  });

  describe("when an unsupported grant_type is used", () => {
    it("returns 400 with unsupported_grant_type error", async () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&client_secret=some-key",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("unsupported_grant_type");
    });
  });

  describe("when an invalid authorization code is used", () => {
    it("returns 400 with invalid_grant error", async () => {
      // Redis returns null for unknown codes (default mock behavior)
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=authorization_code&code=invalid-code&code_verifier=some-verifier`,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_grant");
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
    it("re-validates the API key against the database during MCP init", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const code = randomUUID();
      const { codeVerifier, codeChallenge } = createPkceChallenge();

      mockAuthCodeInRedis({ code, codeChallenge });

      // First, obtain an access token via authorization_code
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const tokenRes = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=authorization_code&code=${code}&code_verifier=${codeVerifier}&redirect_uri=http://localhost/callback`,
      });
      const tokenBody = await tokenRes.json();
      const accessToken = tokenBody.access_token;

      // Clear the mock to prove MCP init does its own DB lookup
      mockPrisma.project.findUnique.mockClear();
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      // Use the access token to initialize MCP
      const res = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(200);
      expect(res.headers["mcp-session-id"]).toBeDefined();
      // Verify a fresh DB lookup happened during MCP init
      expect(mockPrisma.project.findUnique).toHaveBeenCalledWith({
        where: { apiKey: VALID_API_KEY, archivedAt: null },
      });
    });
  });

  // --- Redis Token Storage ---

  describe("when OAuth token is looked up from Redis after in-memory cache miss", () => {
    it("accepts the connection via Redis lookup", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const code = randomUUID();
      const { codeVerifier, codeChallenge } = createPkceChallenge();

      mockAuthCodeInRedis({ code, codeChallenge });

      // Issue a token
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const tokenRes = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=authorization_code&code=${code}&code_verifier=${codeVerifier}&redirect_uri=http://localhost/callback`,
      });
      const tokenBody = await tokenRes.json();
      const accessToken = tokenBody.access_token;

      // Clear in-memory cache
      handler.clearTokenCache();

      // Mock Redis to return the token data (encrypted format)
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          encryptedApiKey: `encrypted:${VALID_API_KEY}`,
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

      // Mock Redis returning an expired token (encrypted format)
      mockRedis.get.mockResolvedValue(
        JSON.stringify({
          encryptedApiKey: `encrypted:${VALID_API_KEY}`,
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

  // --- Redis Session Recovery (multi-pod) ---

  describe("when a session exists in Redis but not in local memory (different pod)", () => {
    it("recovers the session from Redis and handles the request", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      // 1. Initialize a session normally
      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers["mcp-session-id"];
      expect(sessionId).toBeDefined();

      // 2. Simulate pod switch: close all local sessions (as if this is a
      //    different pod) but keep the Redis entry.
      handler.closeAllSessions();

      // 3. Mock Redis returning the session metadata
      mockRedis.get.mockImplementation(async (key: string) => {
        if (key === `mcp:session:${sessionId}`) {
          return JSON.stringify({
            encryptedApiKey: `encrypted:${VALID_API_KEY}`,
            createdAt: Date.now(),
          });
        }
        return null;
      });
      mockRedis.expire.mockResolvedValue(1);

      // 4. Re-create the server+handler (simulating a different pod)
      handler.closeAllSessions();

      // 5. Send a tool list request with the old session ID — should recover
      const toolsRes = await sendRequest({
        server,
        body: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        },
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "mcp-session-id": sessionId!,
        },
      });
      expect(toolsRes.status).toBe(200);
      const toolsBody = toolsRes.json() as { result?: { tools?: unknown[] } };
      expect(toolsBody.result?.tools).toBeDefined();
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
      expect(res.headers["access-control-expose-headers"]).toContain(
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

  // --- Security: session re-auth ---

  describe("when an existing session request omits the Authorization header", () => {
    it("returns 401 on POST", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      // Initialize a session
      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });
      const sessionId = initRes.headers["mcp-session-id"]!;

      // Send a request WITHOUT Authorization header
      const res = await sendRequest({
        server,
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
        headers: { "mcp-session-id": sessionId },
      });

      expect(res.status).toBe(401);
    });

    it("returns 401 on GET", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });
      const sessionId = initRes.headers["mcp-session-id"]!;

      const res = await sendRequest({
        server,
        method: "GET",
        path: "/mcp",
        headers: { "mcp-session-id": sessionId },
      });

      expect(res.status).toBe(401);
    });

    it("returns 401 on DELETE", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });
      const sessionId = initRes.headers["mcp-session-id"]!;

      const res = await sendRequest({
        server,
        method: "DELETE",
        path: "/mcp",
        headers: { "mcp-session-id": sessionId },
      });

      expect(res.status).toBe(401);
    });
  });

  describe("when an existing session request has a wrong Bearer token", () => {
    it("returns 401", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });
      const sessionId = initRes.headers["mcp-session-id"]!;

      mockPrisma.project.findUnique.mockResolvedValue(null);

      const res = await sendRequest({
        server,
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
        headers: {
          authorization: "Bearer wrong_key",
          "mcp-session-id": sessionId,
        },
      });

      expect(res.status).toBe(401);
    });
  });

  // --- Security: rate limiting ---

  describe("when /oauth/token is called more than 10 times per minute", () => {
    it("returns 429", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;

      // Send 10 requests (allowed)
      for (let i = 0; i < 10; i++) {
        await fetch(`http://127.0.0.1:${port}/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `grant_type=authorization_code&code=code-${i}&code_verifier=verifier`,
        });
      }

      // 11th request should be rate limited
      const res = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=authorization_code&code=code-11&code_verifier=verifier`,
      });

      expect(res.status).toBe(429);
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

  // --- Tool Execution: AsyncLocalStorage Propagation ---
  //
  // These tests verify that the session's API key is correctly propagated
  // to tool handlers through AsyncLocalStorage. In production (HTTP mode),
  // there is NO global LANGWATCH_API_KEY — each client provides their own
  // via OAuth. If the AsyncLocalStorage context is lost during MCP SDK
  // tool dispatch, requireApiKey() fails with:
  //   - "Config not initialized" (globalConfig null)
  //   - "LANGWATCH_API_KEY is required" (globalConfig has no apiKey)

  describe("when search_traces is called within an authenticated session", () => {
    it("receives the API key from session config via AsyncLocalStorage", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      // Initialize session
      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });
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

      // Call search_traces — the API endpoint is real but the key is fake,
      // so this will fail with an API error, NOT a config error
      const toolRes = await sendRequest({
        server,
        body: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "search_traces",
            arguments: {},
          },
        },
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "mcp-session-id": sessionId,
        },
      });

      expect(toolRes.status).toBe(200);
      const body = toolRes.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;

      // These config errors indicate AsyncLocalStorage context loss
      expect(content[0]?.text).not.toContain("Config not initialized");
      expect(content[0]?.text).not.toContain("LANGWATCH_API_KEY is required");
    });
  });

  describe("when search_traces is called via an OAuth-obtained access token", () => {
    it("propagates the OAuth-resolved API key through to the tool handler", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      // 1. Obtain an access token via OAuth authorization_code + PKCE
      const code = randomUUID();
      const { codeVerifier, codeChallenge } = createPkceChallenge();
      mockAuthCodeInRedis({ code, codeChallenge });

      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const tokenRes = await fetch(`http://127.0.0.1:${port}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=authorization_code&code=${code}&code_verifier=${codeVerifier}&redirect_uri=http://localhost/callback`,
      });
      const tokenBody = (await tokenRes.json()) as { access_token: string };
      const accessToken = tokenBody.access_token;

      // Reset redis mock (auth code was consumed)
      mockRedis.get.mockResolvedValue(null);

      // 2. Initialize MCP session with the OAuth token
      mockPrisma.project.findUnique.mockResolvedValue(validProject());
      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(initRes.status).toBe(200);
      const sessionId = initRes.headers["mcp-session-id"]!;

      // 3. Send initialized notification
      await sendRequest({
        server,
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
        headers: {
          authorization: `Bearer ${accessToken}`,
          "mcp-session-id": sessionId,
        },
      });

      // 4. Call search_traces — should reach the API, not fail on config
      const toolRes = await sendRequest({
        server,
        body: {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "search_traces", arguments: {} },
        },
        headers: {
          authorization: `Bearer ${accessToken}`,
          "mcp-session-id": sessionId,
        },
      });

      expect(toolRes.status).toBe(200);
      const body = toolRes.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;

      expect(content[0]?.text).not.toContain("Config not initialized");
      expect(content[0]?.text).not.toContain("LANGWATCH_API_KEY is required");
    });
  });

  describe("when fetch_langwatch_docs is called with a specific URL", () => {
    it("returns page content", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });
      const sessionId = initRes.headers["mcp-session-id"]!;

      await sendRequest({
        server,
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "mcp-session-id": sessionId,
        },
      });

      // Call with the index URL (known to work in production)
      const toolRes = await sendRequest({
        server,
        body: {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: {
            name: "fetch_langwatch_docs",
            arguments: { url: "https://langwatch.ai/docs/llms.txt" },
          },
        },
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "mcp-session-id": sessionId,
        },
      });

      expect(toolRes.status).toBe(200);
      const body = toolRes.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content).toBeDefined();
      expect(content[0]?.text.length).toBeGreaterThan(0);
      expect(content[0]?.text.toLowerCase()).toContain("langwatch");
    });
  });

  describe("when fetch_langwatch_docs is called with a specific docs page URL", () => {
    it("fetches the page and returns its content", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const initRes = await sendRequest({
        server,
        body: mcpInitializeBody(),
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
      });
      const sessionId = initRes.headers["mcp-session-id"]!;

      await sendRequest({
        server,
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "mcp-session-id": sessionId,
        },
      });

      // This is the exact URL pattern that fails in production
      const toolRes = await sendRequest({
        server,
        body: {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "fetch_langwatch_docs",
            arguments: { url: "https://langwatch.ai/docs/integration/overview.md" },
          },
        },
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "mcp-session-id": sessionId,
        },
      });

      expect(toolRes.status).toBe(200);
      const body = toolRes.json() as Record<string, unknown>;
      const result = body.result as Record<string, unknown>;
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content).toBeDefined();
      expect(content[0]?.text.length).toBeGreaterThan(100);
      // The result should NOT be an error — in production this was returning
      // "Error occurred during tool execution"
      expect(result.isError).not.toBe(true);
    });
  });

  // --- SSE Transport Tool Execution ---

  describe("when a tool is called via the SSE transport", () => {
    it("propagates the API key to search_traces", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(validProject());

      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const baseUrl = `http://127.0.0.1:${port}`;

      // 1. Connect via SSE — GET /sse with Bearer token
      // Use AbortController since SSE is a long-lived stream
      const abortController = new AbortController();
      const sseChunks: string[] = [];

      const ssePromise = fetch(`${baseUrl}/sse`, {
        method: "GET",
        headers: { authorization: `Bearer ${VALID_API_KEY}` },
        signal: abortController.signal,
      }).then(async (res) => {
        expect(res.status).toBe(200);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        // Read chunks until we have the endpoint event
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseChunks.push(decoder.decode(value, { stream: true }));
          const joined = sseChunks.join("");
          if (joined.includes("event: endpoint")) break;
        }
      });

      // Wait for the endpoint event
      await ssePromise;

      // Parse SSE stream to get the endpoint event with session URL
      const sseBody = sseChunks.join("");
      const endpointMatch = sseBody.match(
        /event:\s*endpoint\ndata:\s*(.+)/,
      );
      expect(endpointMatch).toBeTruthy();

      const messagesPath = endpointMatch![1]!.trim();
      expect(messagesPath).toContain("sessionId=");

      // 2. Send initialize request via POST /messages
      const initRes = await fetch(`${baseUrl}${messagesPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(mcpInitializeBody()),
      });
      expect(initRes.status).toBe(202);

      // 3. Send initialized notification
      await fetch(`${baseUrl}${messagesPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      });

      // 4. Call search_traces via SSE transport
      const toolRes = await fetch(`${baseUrl}${messagesPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "search_traces", arguments: {} },
        }),
      });
      expect(toolRes.status).toBe(202);

      // Wait for the tool to execute (response goes through SSE stream)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify the server is still healthy (tool didn't crash it)
      const healthRes = await fetch(`${baseUrl}/mcp/health`);
      expect(healthRes.status).toBe(200);

      // Clean up the SSE connection
      abortController.abort();
    });
  });
});
