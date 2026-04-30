/**
 * @vitest-environment node
 *
 * Integration regression tests for issue #3576.
 *
 * The `SerializedHttpAgentAdapter` today throws `HTTP <status>: <statusText>` on
 * non-2xx responses and discards the response body, request URL, and upstream
 * identifiers. These tests drive the adapter against a real in-process HTTP stub
 * server and assert the richer error surface (AC #2) and per-call diagnostic
 * logging (AC #4) that the fix must provide.
 *
 * ALL tests in this file are expected to FAIL against the current adapter. They
 * will pass only after the fix in task #5 lands.
 *
 * Logger module spied: `~/utils/logger` — pino via `createLogger`.
 * The fix will call `createLogger("langwatch:http-agent")` at module scope and
 * emit exactly one structured log object per `adapter.call()` invocation.
 */

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import http from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpAgentData } from "../../types";
import * as loggerModule from "~/utils/logger";

// ---------------------------------------------------------------------------
// Bypass SSRF validation so the adapter can reach 127.0.0.1 in tests.
// Established pattern: same as http-trace-propagation.integration.test.ts.
// ---------------------------------------------------------------------------
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: async (url: string, init?: RequestInit) => fetch(url, init),
}));

// Import adapter AFTER the ssrfSafeFetch mock is registered.
const { SerializedHttpAgentAdapter } = await import("../http-agent.adapter");

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Expected redaction placeholder the fix must use for sensitive headers. */
const REDACTED = "[REDACTED]";

/** The fix must truncate error bodies at or below this length. */
const BODY_TRUNCATION_LIMIT = 2048;

// ---------------------------------------------------------------------------
// Stub server
// ---------------------------------------------------------------------------

interface StubConfig {
  status: number;
  headers?: Record<string, string>;
  body: string;
  contentType?: string;
}

interface StubServer {
  url: string;
  configure: (cfg: StubConfig) => void;
  close: () => Promise<void>;
}

async function createStubServer(): Promise<StubServer> {
  let current: StubConfig = {
    status: 200,
    body: JSON.stringify({ message: "ok" }),
    contentType: "application/json",
  };

  const server = http.createServer((_req, res) => {
    const cfg = current;
    res.statusCode = cfg.status;
    res.setHeader("Content-Type", cfg.contentType ?? "application/json");
    for (const [k, v] of Object.entries(cfg.headers ?? {})) {
      res.setHeader(k, v);
    }
    res.end(cfg.body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    configure: (cfg) => { current = cfg; },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

// ---------------------------------------------------------------------------
// Logger capture helper
//
// Creates a pino-compatible stub that records every call to info/debug/warn/error.
// Returns the captured log entries and the stub to use as createLogger's return value.
// ---------------------------------------------------------------------------

interface CapturedLogs {
  entries: unknown[];
}

function makeLoggerStub(): { stub: ReturnType<typeof loggerModule.createLogger>; captured: CapturedLogs } {
  const captured: CapturedLogs = { entries: [] };

  const stub = {
    info: (...args: unknown[]) => captured.entries.push({ level: "info", ...flattenPinoArgs(args) }),
    debug: (...args: unknown[]) => captured.entries.push({ level: "debug", ...flattenPinoArgs(args) }),
    warn: (...args: unknown[]) => captured.entries.push({ level: "warn", ...flattenPinoArgs(args) }),
    error: (...args: unknown[]) => captured.entries.push({ level: "error", ...flattenPinoArgs(args) }),
    child: () => stub,
    // Satisfy Logger type — other pino fields are unused by the adapter
    level: "info",
    trace: () => undefined,
    fatal: () => undefined,
    silent: () => undefined,
  } as unknown as ReturnType<typeof loggerModule.createLogger>;

  return { stub, captured };
}

/**
 * Pino is called as either `logger.info(msg)` or `logger.info(obj, msg)`.
 * Merge them into a flat object for easy assertion.
 */
function flattenPinoArgs(args: unknown[]): Record<string, unknown> {
  if (args.length === 0) return {};
  if (args.length === 1) {
    return typeof args[0] === "object" && args[0] !== null
      ? (args[0] as Record<string, unknown>)
      : { msg: args[0] };
  }
  const [obj, msg, ...rest] = args;
  return {
    ...(typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>) : {}),
    msg,
    ...(rest.length ? { extra: rest } : {}),
  };
}

// ---------------------------------------------------------------------------
// Shared input fixture
// ---------------------------------------------------------------------------

const baseInput: AgentInput = {
  threadId: "thread_test",
  messages: [{ role: "user", content: "hello" }],
  newMessages: [{ role: "user", content: "hello" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

function makeConfig(url: string, overrides?: Partial<HttpAgentData>): HttpAgentData {
  return {
    type: "http",
    agentId: "agent_test",
    url,
    method: "POST",
    headers: [],
    outputPath: "$.message",
    ...overrides,
  };
}

// ============================================================================
// AC #2 — Error context on non-2xx responses
// ============================================================================

describe("given an HTTP agent target pointed at a stub returning 422 with a JSON error body", () => {
  let stub: StubServer;
  const REQUEST_ID = "req-abc-123";

  beforeAll(async () => { stub = await createStubServer(); });
  afterAll(async () => { await stub.close(); });

  beforeEach(() => {
    stub.configure({
      status: 422,
      headers: { "x-request-id": REQUEST_ID },
      body: JSON.stringify({ error: "Unprocessable Entity", detail: "invalid input" }),
      contentType: "application/json",
    });
  });

  describe("when the adapter calls the stub", () => {
    it("includes the request URL in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await expect(adapter.call(baseInput)).rejects.toThrow(stub.url);
    });

    it("includes the response status 422 in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await expect(adapter.call(baseInput)).rejects.toThrow("422");
    });

    it("includes the response body in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      // "invalid input" comes from the JSON body
      await expect(adapter.call(baseInput)).rejects.toThrow("invalid input");
    });

    it("includes the x-request-id response header value in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await expect(adapter.call(baseInput)).rejects.toThrow(REQUEST_ID);
    });
  });
});

describe("given an HTTP agent target pointed at a stub returning 500 with a body larger than the truncation limit", () => {
  let stub: StubServer;
  const LARGE_BODY = "E".repeat(BODY_TRUNCATION_LIMIT * 2);

  beforeAll(async () => { stub = await createStubServer(); });
  afterAll(async () => { await stub.close(); });

  beforeEach(() => {
    stub.configure({
      status: 500,
      body: LARGE_BODY,
      contentType: "text/plain",
    });
  });

  describe("when the adapter calls the stub", () => {
    it("includes a truncated portion of the body in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      let message = "";
      try { await adapter.call(baseInput); } catch (e) { message = (e as Error).message; }
      // The error must contain at least the first 100 chars of the body
      expect(message).toContain(LARGE_BODY.slice(0, 100));
    });

    it("indicates the body was truncated in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      let message = "";
      try { await adapter.call(baseInput); } catch (e) { message = (e as Error).message; }
      // Any common truncation marker: "...", "…", "[truncated]", "(truncated)"
      expect(message).toMatch(/\.\.\.|…|\[truncated\]|\(truncated\)/i);
    });
  });
});

describe("given an HTTP agent target pointed at a stub returning 502 with a plain-text body", () => {
  let stub: StubServer;
  const PLAIN_TEXT_BODY = "Bad Gateway: upstream timed out";

  beforeAll(async () => { stub = await createStubServer(); });
  afterAll(async () => { await stub.close(); });

  beforeEach(() => {
    stub.configure({
      status: 502,
      body: PLAIN_TEXT_BODY,
      contentType: "text/plain",
    });
  });

  describe("when the adapter calls the stub", () => {
    it("includes the plain-text body content in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await expect(adapter.call(baseInput)).rejects.toThrow(PLAIN_TEXT_BODY);
    });
  });
});

describe("given an HTTP agent target returning 422 with x-amzn-requestid (no x-request-id)", () => {
  let stub: StubServer;
  const AMZN_ID = "amzn-req-xyz-789";

  beforeAll(async () => { stub = await createStubServer(); });
  afterAll(async () => { await stub.close(); });

  beforeEach(() => {
    stub.configure({
      status: 422,
      headers: { "x-amzn-requestid": AMZN_ID },
      body: JSON.stringify({ error: "validation failed" }),
      contentType: "application/json",
    });
  });

  describe("when the adapter calls the stub", () => {
    it("includes the x-amzn-requestid header value in the thrown error", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await expect(adapter.call(baseInput)).rejects.toThrow(AMZN_ID);
    });
  });
});

describe("given a request that sets Authorization and x-api-key headers", () => {
  let stub: StubServer;

  beforeAll(async () => { stub = await createStubServer(); });
  afterAll(async () => { await stub.close(); });

  beforeEach(() => {
    stub.configure({
      status: 422,
      body: JSON.stringify({ error: "forbidden" }),
      contentType: "application/json",
    });
  });

  describe("when the adapter formats those request headers for logging or error context", () => {
    it("replaces the values of Authorization and x-api-key with a redacted placeholder", async () => {
      const config = makeConfig(stub.url, {
        headers: [{ key: "x-api-key", value: "my-secret-key" }],
        auth: { type: "bearer", token: "super-secret-token" },
      });
      const adapter = new SerializedHttpAgentAdapter(config);

      let message = "";
      try { await adapter.call(baseInput); } catch (e) { message = (e as Error).message; }

      // Secret values must NOT appear in the error message
      expect(message).not.toContain("super-secret-token");
      expect(message).not.toContain("my-secret-key");

      // If the error includes those header names, it must show the redacted placeholder
      if (message.includes("Authorization") || message.includes("x-api-key")) {
        expect(message).toContain(REDACTED);
      }
    });
  });
});

// ============================================================================
// AC #4 — Per-call diagnostic logging
// ============================================================================

describe("given an HTTP agent target pointed at a stub returning 200 (for diagnostic logging)", () => {
  let stub: StubServer;
  let captured: CapturedLogs;
  const REQUEST_ID = "diag-req-001";

  beforeAll(async () => { stub = await createStubServer(); });
  afterAll(async () => { await stub.close(); });

  beforeEach(() => {
    stub.configure({
      status: 200,
      headers: { "x-request-id": REQUEST_ID },
      body: JSON.stringify({ message: "success" }),
      contentType: "application/json",
    });

    // Install the logger stub. The fix creates a module-level logger via
    // createLogger("langwatch:http-agent"). By mocking createLogger here we
    // intercept that call and route log output to `captured`.
    const { stub: loggerStub, captured: cap } = makeLoggerStub();
    captured = cap;
    vi.spyOn(loggerModule, "createLogger").mockReturnValue(loggerStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when the adapter calls the stub", () => {
    it("emits exactly one structured diagnostic log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);
      // Current adapter: no logger → captured.entries.length === 0 → FAILS
      expect(captured.entries).toHaveLength(1);
    });

    it("includes the request URL in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);
      const serialized = JSON.stringify(captured.entries);
      expect(serialized).toContain(stub.url);
    });

    it("includes the HTTP method in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);
      const serialized = JSON.stringify(captured.entries);
      expect(serialized).toMatch(/POST/i);
    });

    it("includes the response status 200 in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);
      const hasStatus = captured.entries.some(
        (e) => typeof e === "object" && e !== null && (e as Record<string, unknown>).status === 200,
      );
      expect(hasStatus).toBe(true);
    });

    it("includes a duration_ms field in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);
      const hasDuration = captured.entries.some(
        (e) =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as Record<string, unknown>).duration_ms === "number",
      );
      expect(hasDuration).toBe(true);
    });

    it("includes the upstream x-request-id in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);
      const serialized = JSON.stringify(captured.entries);
      expect(serialized).toContain(REQUEST_ID);
    });
  });
});

describe("given an HTTP agent target pointed at a stub returning 422 (for diagnostic logging)", () => {
  let stub: StubServer;
  let captured: CapturedLogs;

  beforeAll(async () => { stub = await createStubServer(); });
  afterAll(async () => { await stub.close(); });

  beforeEach(() => {
    stub.configure({
      status: 422,
      headers: { "x-request-id": "fail-req-999" },
      body: JSON.stringify({ error: "Unprocessable Entity", detail: "bad payload" }),
      contentType: "application/json",
    });

    const { stub: loggerStub, captured: cap } = makeLoggerStub();
    captured = cap;
    vi.spyOn(loggerModule, "createLogger").mockReturnValue(loggerStub);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  describe("when the adapter calls the stub", () => {
    it("emits exactly one structured diagnostic log line for a failing call", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);
      // Current adapter: no logger → 0 entries → FAILS
      expect(captured.entries).toHaveLength(1);
    });

    it("includes response status 422 in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);
      const hasStatus = captured.entries.some(
        (e) => typeof e === "object" && e !== null && (e as Record<string, unknown>).status === 422,
      );
      expect(hasStatus).toBe(true);
    });

    it("includes a redacted, truncated sample of the response body in the log line", async () => {
      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);
      const serialized = JSON.stringify(captured.entries);
      // The log must reference the body in some form
      expect(serialized).toMatch(/body|response_body|body_sample/i);
    });
  });
});

describe("given an HTTP agent target pointed at a stub returning a JSON 200 response", () => {
  let stub: StubServer;

  beforeAll(async () => { stub = await createStubServer(); });
  afterAll(async () => { await stub.close(); });

  beforeEach(() => {
    stub.configure({
      status: 200,
      body: JSON.stringify({ message: "hello from stub" }),
      contentType: "application/json",
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  describe("when the adapter calls the stub", () => {
    it("emits the diagnostic log line", async () => {
      const { stub: loggerStub, captured } = makeLoggerStub();
      vi.spyOn(loggerModule, "createLogger").mockReturnValue(loggerStub);

      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      await adapter.call(baseInput).catch(() => undefined);

      // Current adapter: no logger → 0 entries → FAILS
      expect(captured.entries.length).toBeGreaterThanOrEqual(1);
    });

    it("still returns the parsed JSON response to its caller after logging", async () => {
      // Verifies the "read body once" path: logging must not consume the stream
      // before the adapter can extract and return the response value.
      const { stub: loggerStub } = makeLoggerStub();
      vi.spyOn(loggerModule, "createLogger").mockReturnValue(loggerStub);

      const adapter = new SerializedHttpAgentAdapter(makeConfig(stub.url));
      // outputPath "$.message" extracts { message: "hello from stub" }.message
      const result = await adapter.call(baseInput);
      expect(result).toBe("hello from stub");
    });
  });
});

describe("given a request that sets Authorization and x-api-key headers (diagnostic log redaction)", () => {
  let stub: StubServer;

  beforeAll(async () => { stub = await createStubServer(); });
  afterAll(async () => { await stub.close(); });

  beforeEach(() => {
    stub.configure({
      status: 200,
      body: JSON.stringify({ message: "ok" }),
      contentType: "application/json",
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  describe("when the diagnostic log line is emitted for that request", () => {
    it("does not include the Authorization or x-api-key values in the log line", async () => {
      const { stub: loggerStub, captured } = makeLoggerStub();
      vi.spyOn(loggerModule, "createLogger").mockReturnValue(loggerStub);

      const config = makeConfig(stub.url, {
        headers: [{ key: "x-api-key", value: "secret-api-key-value" }],
        auth: { type: "bearer", token: "very-secret-bearer-token" },
      });
      const adapter = new SerializedHttpAgentAdapter(config);
      await adapter.call(baseInput).catch(() => undefined);

      const serialized = JSON.stringify(captured.entries);
      expect(serialized).not.toContain("very-secret-bearer-token");
      expect(serialized).not.toContain("secret-api-key-value");
    });

    it("includes the redacted placeholder in place of sensitive header values", async () => {
      const { stub: loggerStub, captured } = makeLoggerStub();
      vi.spyOn(loggerModule, "createLogger").mockReturnValue(loggerStub);

      const config = makeConfig(stub.url, {
        headers: [{ key: "x-api-key", value: "secret-api-key-value" }],
        auth: { type: "bearer", token: "very-secret-bearer-token" },
      });
      const adapter = new SerializedHttpAgentAdapter(config);
      await adapter.call(baseInput).catch(() => undefined);

      const serialized = JSON.stringify(captured.entries);
      // Only assert the placeholder if the log includes the header names at all
      if (serialized.includes("Authorization") || serialized.includes("x-api-key")) {
        expect(serialized).toContain(REDACTED);
      }
    });
  });
});
