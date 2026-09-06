/**
 * @vitest-environment node
 *
 * The MCP routes are answered by a raw Node handler that returns before the
 * app's Hono stack, so they never reached the access log, the metrics or the
 * traces the rest of the app produces. A broken integration was invisible:
 * nothing recorded that the request had happened at all.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_API_KEY = "lw_logging_key";

const { mockPrisma, logLines, loggerStub, redisRecords, mockRedis } = vi.hoisted(() => {
  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  const record = () => (fields: unknown, message?: unknown) => {
    if (typeof fields === "object" && fields !== null) {
      lines.push({
        fields: fields as Record<string, unknown>,
        message: String(message ?? ""),
      });
    }
  };
  const stub: Record<string, unknown> = {
    info: record(),
    debug: record(),
    warn: record(),
    error: record(),
    fatal: record(),
    trace: record(),
  };
  stub.child = () => stub;
  const records = new Map<string, string>();
  return {
    redisRecords: records,
    mockRedis: {
      get: vi.fn(async (key: string) => records.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        records.set(key, value);
      }),
      del: vi.fn(async (key: string) => records.delete(key)),
      sadd: vi.fn(async () => 1),
      srem: vi.fn(async () => 1),
      smembers: vi.fn(async () => []),
      expire: vi.fn(async () => 1),
      publish: vi.fn(async () => 1),
    },
    logLines: lines,
    loggerStub: stub,
    mockPrisma: {
      project: {
        findUnique: vi.fn(({ where }: { where: { apiKey: string } }) =>
          Promise.resolve(
            where.apiKey === "lw_logging_key"
              ? {
                  id: "logging-project",
                  apiKey: where.apiKey,
                  teamId: "team-1",
                  archivedAt: null,
                }
              : null,
          ),
        ),
      },
    },
  };
});

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createLogger: () => loggerStub };
});

vi.mock("~/server/app-layer/app", () => ({ tryGetApp: () => ({ redis: mockRedis }) }));

vi.mock("~/server/db", () => ({ prisma: mockPrisma }));
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => text,
  decrypt: (text: string) => text,
}));

import { createMcpHandler, type McpHandler } from "../handler";
function initializeBody(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "logging-test", version: "1.0.0" },
    },
  };
}

async function postMessage({
  baseUrl,
  path,
  apiKey,
  body,
}: {
  baseUrl: string;
  path: string;
  apiKey: string;
  body: unknown;
}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await response.text();
  return response;
}

describe("Feature: MCP request logging", () => {
  let server: Server;
  let handler: McpHandler;
  let baseUrl: string;

  beforeAll(async () => {
    handler = createMcpHandler();
    server = createServer((req, res) => handler.handleRequest(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await handler.closeAllSessions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    logLines.length = 0;
  });

  /** Waits for the access log line, which is written when the response closes. */
  async function accessLogFor(path: string) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const line = logLines.find((l) => l.message === "MCP request" && l.fields.path === path);
      if (line) return line;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no access log line was written for ${path}`);
  }

  const requestHeaders = {
    authorization: `Bearer ${VALID_API_KEY}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };

  async function initializeSession() {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(initializeBody(1)),
    });
    await response.text();
    const sessionId = response.headers.get("mcp-session-id");
    if (!sessionId) throw new Error("Initialize did not create a session");
    await accessLogFor("/mcp");
    logLines.length = 0;
    mockPrisma.project.findUnique.mockClear();
    return sessionId;
  }

  it("stores the authenticated project with the session for other replicas", async () => {
    const sessionId = await initializeSession();
    const stored = redisRecords.get(`mcp:session:${sessionId}`);
    expect(stored).toBeDefined();
    expect(JSON.parse(stored ?? "null")).toMatchObject({ projectId: "logging-project" });
  });

  it.each(["POST", "GET", "DELETE"])(
    "attributes an established session's %s without another project lookup",
    async (method) => {
      const sessionId = await initializeSession();
      const abort = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/mcp`, {
          method,
          headers: { ...requestHeaders, "mcp-session-id": sessionId },
          signal: abort.signal,
          ...(method === "POST"
            ? { body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) }
            : {}),
        });
        expect(response.status).toBe(200);
        if (method !== "GET") await response.text();
      } finally {
        abort.abort();
      }
      const line = await accessLogFor("/mcp");
      expect(line.fields.projectId).toBe("logging-project");
      expect(line.fields.sessionId).toBe(sessionId);
      expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
      expect(JSON.stringify(line)).not.toContain(VALID_API_KEY);
    },
  );

  it("does not attribute another project's session on a bearer mismatch", async () => {
    const sessionId = await initializeSession();
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "DELETE",
      headers: { authorization: "Bearer lw_other_project", "mcp-session-id": sessionId },
    });
    expect(response.status).toBe(401);
    expect((await accessLogFor("/mcp")).fields).not.toHaveProperty("projectId");
  });

  it.each([true, false])("attributes a Redis recovered session (legacy: %s)", async (legacy) => {
    const sessionId = `recovered-logging-${legacy}`;
    redisRecords.set(
      `mcp:session:${sessionId}`,
      JSON.stringify({
        encryptedApiKey: VALID_API_KEY,
        ...(legacy ? {} : { projectId: "logging-project" }),
      }),
    );
    mockPrisma.project.findUnique.mockClear();
    for (let id = 2; id < 4; id++) {
      logLines.length = 0;
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { ...requestHeaders, "mcp-session-id": sessionId },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list", params: {} }),
      });
      expect(response.status).toBe(200);
      await response.text();
      expect((await accessLogFor("/mcp")).fields.projectId).toBe("logging-project");
    }
    expect(mockPrisma.project.findUnique).toHaveBeenCalledTimes(legacy ? 1 : 0);
  });

  it("attributes local SSE messages", async () => {
    const abort = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/sse`, {
        headers: requestHeaders,
        signal: abort.signal,
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("SSE response has no body");
      const event = await reader.read();
      const endpoint = new TextDecoder().decode(event.value).match(/data: (.+)/)?.[1];
      if (!endpoint) throw new Error("SSE stream has no message endpoint");
      mockPrisma.project.findUnique.mockClear();
      const posted = await postMessage({
        baseUrl,
        path: endpoint,
        apiKey: VALID_API_KEY,
        body: initializeBody(1),
      });
      expect(posted.status).toBe(202);
      expect((await accessLogFor("/messages")).fields.projectId).toBe("logging-project");
      expect(mockPrisma.project.findUnique).not.toHaveBeenCalled();
    } finally {
      abort.abort();
    }
  });

  it.each([true, false])("attributes relayed SSE messages (legacy: %s)", async (legacy) => {
    const sessionId = `remote-sse-${legacy}`;
    redisRecords.set(
      `mcp:sse:session:${sessionId}`,
      JSON.stringify({
        encryptedApiKey: VALID_API_KEY,
        ...(legacy ? {} : { projectId: "logging-project" }),
      }),
    );
    mockPrisma.project.findUnique.mockClear();
    for (let id = 1; id < 3; id++) {
      logLines.length = 0;
      const response = await postMessage({
        baseUrl,
        path: `/messages?sessionId=${sessionId}`,
        apiKey: VALID_API_KEY,
        body: initializeBody(id),
      });
      expect(response.status).toBe(202);
      expect((await accessLogFor("/messages")).fields.projectId).toBe("logging-project");
    }
    expect(mockPrisma.project.findUnique).toHaveBeenCalledTimes(legacy ? 1 : 0);
    expect(mockRedis.publish).toHaveBeenCalledWith(
      `mcp:sse:relay:${sessionId}`,
      JSON.stringify(initializeBody(2)),
    );
  });

  describe("given a client sends a request to an MCP route", () => {
    describe("when the response completes", () => {
      /** @scenario Every MCP request is logged with its outcome */
      it("records the method, path, status and duration without any credentials", async () => {
        await fetch(`${baseUrl}/mcp/health`, {
          headers: { authorization: `Bearer ${VALID_API_KEY}` },
        });

        const line = await accessLogFor("/mcp/health");

        expect(line.fields.method).toBe("GET");
        expect(line.fields.status).toBe(200);
        expect(typeof line.fields.durationMs).toBe("number");

        const serialized = JSON.stringify(line);
        expect(serialized).not.toContain(VALID_API_KEY);
        expect(serialized.toLowerCase()).not.toContain("authorization");
      });
    });

    describe("when the request fails", () => {
      it("records the failing status too", async () => {
        await fetch(`${baseUrl}/sse`, { method: "GET" });

        const line = await accessLogFor("/sse");

        expect(line.fields.status).toBe(401);
      });
    });

    describe("when an authenticated request completes", () => {
      /** @scenario MCP request logs carry the tenant and the client */
      it("records the project the credential resolved to and the client attribution", async () => {
        await fetch(`${baseUrl}/mcp`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${VALID_API_KEY}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "user-agent": "langwatch-mcp/1.4.0",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "attribution-test", version: "1.0.0" },
            },
          }),
        });

        const line = await accessLogFor("/mcp");

        expect(line.fields.projectId).toBe("logging-project");
        expect(line.fields.endpointClass).toBe("mcp");
        expect(line.fields.clientSource).toBe("mcp");
        expect(line.fields.userAgent).toBe("langwatch-mcp/1.4.0");
      });
    });
  });
});
