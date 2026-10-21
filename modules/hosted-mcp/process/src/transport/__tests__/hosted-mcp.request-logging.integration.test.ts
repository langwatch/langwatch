/** @vitest-environment node */
// The MCP routes are answered by a raw Node handler that returns before the
// process's Hono stack, so they never reached the access log, the metrics or
// the traces the rest of the deployment produces. A broken integration was
// invisible: nothing recorded that the request had happened at all.
import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_API_KEY = "lw_logging_key";

const { logLines, loggerStub } = vi.hoisted(() => {
  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  const record = () => (fields: unknown, message?: unknown) => {
    if (typeof fields === "object" && fields !== null) {
      lines.push({
        fields: fields as Record<string, unknown>,
        message: typeof message === "string" ? message : "",
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
  return { logLines: lines, loggerStub: stub };
});

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createLogger: () => loggerStub };
});

import { MemoryMcpOAuthClientRepository } from "../../repositories/memory/memory.mcp-oauth-client.repository.ts";
import { MemoryMcpSessionRepository } from "../../repositories/memory/memory.mcp-session.repository.ts";
import { RedisMcpOAuthTokenRepository } from "../../repositories/redis/redis.mcp-oauth-token.repository.ts";
import type { AuthzMcpSessionGrantService } from "../../services/authz-mcp-session-grant.service.ts";
import type {
  HeaderMcpClientAddressService,
  McpClientAddressSource,
} from "../../services/header-mcp-client-address.service.ts";
import type { McpHandler } from "../../services/mcp-endpoint.service.ts";
import { McpEndpointService } from "../../services/mcp-endpoint.service.ts";
import type {
  McpLiveProjectLookup,
  ProjectMcpProjectLookupService,
} from "../../services/project-mcp-project-lookup.service.ts";
import { answerMcpExchange } from "../mcp-endpoint.rest.ts";
import { FakeCliSessions } from "./support/fake-cli-sessions.ts";

class LoggingProjectLookup implements Pick<
  ProjectMcpProjectLookupService,
  "resolveLiveProjectByApiKey"
> {
  resolveLiveProjectByApiKey({ apiKey }: { apiKey: string }): Promise<McpLiveProjectLookup> {
    return Promise.resolve(
      apiKey === VALID_API_KEY
        ? { kind: "live", project: { id: "logging-project", teamId: "team-1" } }
        : { kind: "unknown" },
    );
  }
}

class AlwaysGranted implements Pick<AuthzMcpSessionGrantService, "stillGranted"> {
  stillGranted(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class LoopbackAddress implements Pick<HeaderMcpClientAddressService, "clientIp"> {
  clientIp(request: McpClientAddressSource): string {
    return request.remoteAddress ?? "127.0.0.1";
  }
}

function initializeBody({ id }: { id: number }) {
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

const toolsListBody = ({ id }: { id: number }) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/list",
  params: {},
});

const requestHeaders = {
  authorization: `Bearer ${VALID_API_KEY}`,
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

/** Waits for the access log line, which is written when the response closes. */
async function accessLogFor(path: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const line = logLines.find((l) => l.message === "MCP request" && l.fields.path === path);
    if (line) return line;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no access log line was written for ${path}`);
}

function portOf(server: Server): number {
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
}

function sessionRecord({ sessionId, legacy }: { sessionId: string; legacy: boolean }) {
  const projectId = legacy ? {} : { projectId: "logging-project" };
  return {
    sessionId,
    apiKey: VALID_API_KEY,
    ...projectId,
  };
}

async function sendSessionRequest({
  baseUrl,
  method,
  sessionId,
}: {
  baseUrl: string;
  method: string;
  sessionId: string;
}): Promise<void> {
  const abort = new AbortController();
  const body = method === "POST" ? { body: JSON.stringify(toolsListBody({ id: 2 })) } : {};
  try {
    const response = await fetch(`${baseUrl}/mcp`, {
      method,
      headers: { ...requestHeaders, "mcp-session-id": sessionId },
      signal: abort.signal,
      ...body,
    });
    expect(response.status).toBe(200);
    if (method !== "GET") await response.text();
  } finally {
    abort.abort();
  }
}

async function expectRecoveredRequestsAttributed({
  baseUrl,
  sessionId,
}: {
  baseUrl: string;
  sessionId: string;
}): Promise<void> {
  for (let id = 2; id < 4; id++) {
    logLines.length = 0;
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...requestHeaders, "mcp-session-id": sessionId },
      body: JSON.stringify(toolsListBody({ id })),
    });
    expect(response.status).toBe(200);
    await response.text();
    expect((await accessLogFor("/mcp")).fields.projectId).toBe("logging-project");
  }
}

describe("Feature: MCP request logging", () => {
  let server: Server;
  let handler: McpHandler;
  let baseUrl: string;
  // Held here so a test can play the replica that wrote a record.
  const records = MemoryMcpSessionRepository.create();
  const projects = new LoggingProjectLookup();
  const projectLookup = vi.spyOn(projects, "resolveLiveProjectByApiKey");

  beforeAll(async () => {
    handler = McpEndpointService.create({
      sessionRecords: records,
      oauthTokenRecords: RedisMcpOAuthTokenRepository.create({ redis: null }),
      oauthClients: MemoryMcpOAuthClientRepository.create(),
      projects,
      grants: new AlwaysGranted(),
      cliSessions: new FakeCliSessions(),
      address: new LoopbackAddress(),
      baseHost: "https://app.langwatch.ai",
    });
    server = createServer((request, response) =>
      answerMcpExchange({ endpoint: handler, runner: handler.sessionRunner, request, response }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${portOf(server)}`;
  });

  afterAll(async () => {
    await handler.closeAllSessions();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    logLines.length = 0;
  });

  async function post({ path, body }: { path: string; body: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    });
    await response.text();
    return response;
  }

  async function initializeSession(): Promise<string> {
    const response = await post({ path: "/mcp", body: initializeBody({ id: 1 }) });
    const sessionId = response.headers.get("mcp-session-id");
    if (!sessionId) throw new Error("Initialize did not create a session");
    await accessLogFor("/mcp");
    logLines.length = 0;
    projectLookup.mockClear();
    return sessionId;
  }

  describe("given a client opened a streamable session", () => {
    it("stores the authenticated project with the session for other replicas", async () => {
      const sessionId = await initializeSession();

      await expect(records.getRecord({ sessionId })).resolves.toMatchObject({
        kind: "found",
        projectId: "logging-project",
      });
    });

    describe("when the client makes another session request", () => {
      it.each(["POST", "GET", "DELETE"])(
        "attributes its %s without another project lookup",
        async (method) => {
          const sessionId = await initializeSession();
          await sendSessionRequest({ baseUrl, method, sessionId });

          const line = await accessLogFor("/mcp");
          expect(line.fields.projectId).toBe("logging-project");
          expect(line.fields.sessionId).toBe(sessionId);
          expect(projectLookup).not.toHaveBeenCalled();
          expect(JSON.stringify(line)).not.toContain(VALID_API_KEY);
        },
      );
    });

    describe("when another project's bearer names the session", () => {
      it("does not attribute the session to it", async () => {
        const sessionId = await initializeSession();

        const response = await fetch(`${baseUrl}/mcp`, {
          method: "DELETE",
          headers: { authorization: "Bearer lw_other_project", "mcp-session-id": sessionId },
        });

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "Invalid or expired token" });
        expect((await accessLogFor("/mcp")).fields).not.toHaveProperty("projectId");
      });
    });
  });

  describe("given a streamable session stored by another replica", () => {
    describe("when the client resumes it on this replica", () => {
      it.each([true, false])("attributes the recovered session (legacy: %s)", async (legacy) => {
        const sessionId = `recovered-logging-${legacy}`;
        await records.store(sessionRecord({ sessionId, legacy }));
        projectLookup.mockClear();

        await expectRecoveredRequestsAttributed({ baseUrl, sessionId });

        await expect(records.getRecord({ sessionId })).resolves.toMatchObject({
          projectId: "logging-project",
        });
        expect(projectLookup).toHaveBeenCalledTimes(legacy ? 1 : 0);
      });
    });
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
        const response = await fetch(`${baseUrl}/mcp`, { method: "DELETE" });

        const line = await accessLogFor("/mcp");

        expect(line.fields.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Session not found" });
      });
    });

    describe("when an authenticated request completes", () => {
      /** @scenario MCP request logs carry the tenant and the client */
      it("records the project the credential resolved to and the client attribution", async () => {
        await fetch(`${baseUrl}/mcp`, {
          method: "POST",
          headers: { ...requestHeaders, "user-agent": "langwatch-mcp/1.4.0" },
          body: JSON.stringify(initializeBody({ id: 1 })),
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
