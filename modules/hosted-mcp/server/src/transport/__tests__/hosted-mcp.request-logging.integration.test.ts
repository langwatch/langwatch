/** @vitest-environment node */
// The MCP routes are answered by a raw Node handler that returns before the
// process's Hono stack, so they never reached the access log, the metrics or
// the traces the rest of the deployment produces. A broken integration was
// invisible: nothing recorded that the request had happened at all.
import { createServer, type Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_API_KEY = "lw_logging_key";

const { logLines, loggerStub } = vi.hoisted(() => {
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
  return { logLines: lines, loggerStub: stub };
});

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createLogger: () => loggerStub };
});

import {
  createMcpHandler,
  McpApiKeyCipherPort,
  McpClientAddressPort,
  McpProjectLookupPort,
  McpSessionGrantPort,
  type McpHandler,
} from "../../index.ts";

class LoggingProjectLookup extends McpProjectLookupPort {
  tryFindLiveProjectByApiKey({
    apiKey,
  }: {
    apiKey: string;
  }): Promise<{ id: string; teamId: string } | null> {
    return Promise.resolve(
      apiKey === VALID_API_KEY ? { id: "logging-project", teamId: "team-1" } : null,
    );
  }
}

class AlwaysGranted extends McpSessionGrantPort {
  stillGranted(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class PassThroughCipher extends McpApiKeyCipherPort {
  encrypt(text: string): string {
    return text;
  }
  decrypt(text: string): string {
    return text;
  }
}

class LoopbackAddress extends McpClientAddressPort {
  clientIp(request: IncomingMessage): string {
    return request.socket.remoteAddress ?? "127.0.0.1";
  }
}

describe("Feature: MCP request logging", () => {
  let server: Server;
  let handler: McpHandler;
  let baseUrl: string;

  beforeAll(async () => {
    handler = createMcpHandler({
      redis: null,
      projects: new LoggingProjectLookup(),
      grants: new AlwaysGranted(),
      cipher: new PassThroughCipher(),
      address: new LoopbackAddress(),
      baseHost: "https://app.langwatch.ai",
    });
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
  });
});
